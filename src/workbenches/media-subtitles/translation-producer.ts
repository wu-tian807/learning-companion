import {
  spawn,
  type ChildProcessByStdio,
} from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';

import type {
  AssetArtifactProduceRequest,
  AssetArtifactProducer,
  ProducedAssetArtifact,
} from '../../main/artifacts/asset-artifact-registry';
import { AppError } from '../../main/errors/app-error';
import {
  ExternalProcessTerminator,
  type ExternalProcessTerminatorApi,
} from '../../main/external-libraries/external-process-terminator';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  isSubtitleSourceTrackV1,
  isTranslatableSubtitleLanguage,
  type SubtitleCueV1,
  type SubtitleTranslationCueV1,
  type SubtitleTranslationTrackV1,
  type TranslatableSubtitleLanguage,
} from './contracts';
import { mediaSubtitleDependencyVersions } from './external-libraries/definitions';
import type {
  HyMtSubtitleRuntime,
  MediaSubtitleRuntimeResolverApi,
} from './external-libraries/media-subtitle-runtime';

export const MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID =
  'builtin.media-subtitles.translation';
export const MEDIA_SUBTITLE_TRANSLATION_PRODUCER_VERSION = '1';

const SERVER_START_TIMEOUT_MS = 120_000;
const TRANSLATION_CONCURRENCY = 4;

export interface SubtitleTranslationProgress {
  readonly assetId: string;
  readonly sourceTrackRevision: string;
  readonly cue: SubtitleTranslationCueV1;
  readonly completedCues: number;
  readonly totalCues: number;
}

export type SubtitleTranslationProgressListener = (
  progress: SubtitleTranslationProgress,
) => void;

export interface MediaSubtitleTranslationProducerDependencies {
  readonly now: () => number;
  readonly terminate: ExternalProcessTerminatorApi;
  readonly startSession: SubtitleTranslationSessionFactory;
}

export interface SubtitleTranslationSession {
  translate(
    prompt: string,
    maximumTokens: number,
    signal: AbortSignal,
  ): Promise<string>;
  close(): Promise<void>;
}

export type SubtitleTranslationSessionFactory = (
  runtime: HyMtSubtitleRuntime,
  signal: AbortSignal,
) => Promise<SubtitleTranslationSession>;

interface LlamaServer {
  readonly baseUrl: string;
  readonly child: LlamaChildProcess;
  stop(): Promise<void>;
}

type LlamaChildProcess = ChildProcessByStdio<null, Readable, Readable>;

function translationFailure(error: unknown): AppError {
  return new AppError('MEDIA_SUBTITLE_PROCESSING_FAILED', { cause: error });
}

export function createSubtitleTranslationArtifactKey(
  sourceLanguage: TranslatableSubtitleLanguage,
  targetLanguage: TranslatableSubtitleLanguage,
): string {
  if (sourceLanguage === targetLanguage) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return `translation.${sourceLanguage}.${targetLanguage}.quality`;
}

function parseTranslationArtifactKey(value: string): {
  sourceLanguage: TranslatableSubtitleLanguage;
  targetLanguage: TranslatableSubtitleLanguage;
} {
  const match = /^translation\.([^.]+)\.([^.]+)\.quality$/u.exec(value);
  if (
    !match ||
    !isTranslatableSubtitleLanguage(match[1]) ||
    !isTranslatableSubtitleLanguage(match[2]) ||
    match[1] === match[2]
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return { sourceLanguage: match[1], targetLanguage: match[2] };
}

function languageName(language: TranslatableSubtitleLanguage): string {
  return language === 'en' ? 'English' : 'Simplified Chinese';
}

export function createHyMtCuePrompt(
  cues: readonly SubtitleCueV1[],
  index: number,
  sourceLanguage: TranslatableSubtitleLanguage,
  targetLanguage: TranslatableSubtitleLanguage,
): string {
  const current = cues[index];
  if (!current) throw new AppError('DATA_INTEGRITY_ERROR');

  return [
    '[Background Information]',
    `Previous subtitle: ${cues[index - 1]?.text ?? '(none)'}`,
    `Next subtitle: ${cues[index + 1]?.text ?? '(none)'}`,
    '',
    '[Translation Task]',
    `Translate the [Source Text] from ${languageName(sourceLanguage)} into ${languageName(targetLanguage)}, taking the background information into consideration.`,
    'Translate [Source Text] only. Output only its natural spoken subtitle translation without labels or explanations.',
    '',
    '[Source Text]',
    current.text,
  ].join('\n');
}

export function parseHyMtCueResponse(value: string): string {
  const text = value
    .replace(/^```(?:text)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .replace(/^\s*(?:translation|译文)\s*[:：]\s*/iu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) throw new Error('Hy-MT2 返回了空译文');
  return text;
}

async function availablePort(): Promise<number> {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) rejectPromise(error);
        else if (port > 0) resolvePromise(port);
        else rejectPromise(new Error('无法分配本地翻译端口'));
      });
    });
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolvePromise();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      rejectPromise(new DOMException('Translation cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function waitForServer(
  baseUrl: string,
  child: LlamaChildProcess,
  logs: () => string,
  launchError: () => Error | undefined,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const error = launchError();
    if (error) throw error;
    if (child.exitCode !== null) {
      throw new Error(`Hy-MT2 服务提前退出：${child.exitCode}\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal });
      if (response.ok) return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await delay(100, signal);
  }
  throw new Error(`Hy-MT2 服务启动超时\n${logs()}`);
}

async function stopChild(
  child: LlamaChildProcess,
  terminator: ExternalProcessTerminatorApi,
): Promise<void> {
  if (child.exitCode !== null) return;
  terminator.terminate(child, false);
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (child.exitCode === null) terminator.terminate(child, true);
}

async function startLlamaServer(
  runtime: HyMtSubtitleRuntime,
  signal: AbortSignal,
  terminator: ExternalProcessTerminatorApi,
): Promise<LlamaServer> {
  const port = await availablePort();
  const child = spawn(
    runtime.executablePath,
    [
      '--model', runtime.modelPath,
      '--host', '127.0.0.1',
      '--port', String(port),
      '--ctx-size', '2048',
      '--parallel', String(TRANSLATION_CONCURRENCY),
      '--gpu-layers', runtime.backend === 'vulkan' ? '99' : '0',
      '--jinja',
      '--no-webui',
    ],
    {
      cwd: dirname(runtime.executablePath),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const logChunks: string[] = [];
  let launchError: Error | undefined;
  child.once('error', (error) => {
    launchError = error;
  });
  const capture = (chunk: Buffer) => {
    logChunks.push(chunk.toString('utf8'));
    if (logChunks.length > 200) logChunks.splice(0, logChunks.length - 200);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const abort = () => terminator.terminate(child, false);
  signal.addEventListener('abort', abort, { once: true });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(
      baseUrl,
      child,
      () => logChunks.join('').slice(-24_000),
      () => launchError,
      signal,
    );
    return {
      baseUrl,
      child,
      async stop() {
        signal.removeEventListener('abort', abort);
        await stopChild(child, terminator);
      },
    };
  } catch (error) {
    signal.removeEventListener('abort', abort);
    await stopChild(child, terminator);
    throw error;
  }
}

async function translateCue(
  server: LlamaServer,
  prompt: string,
  maximumTokens: number,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${server.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'Hy-MT2-1.8B-Q4_K_M',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      seed: 1,
      max_tokens: maximumTokens,
      stream: false,
      cache_prompt: false,
    }),
    signal,
  });
  const payload = await response.json() as {
    readonly choices?: readonly [{ readonly message?: { readonly content?: unknown } }];
  };
  if (!response.ok) {
    throw new Error(`Hy-MT2 请求失败：${response.status}`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Hy-MT2 没有返回文本');
  return parseHyMtCueResponse(content);
}

async function startTranslationSession(
  runtime: HyMtSubtitleRuntime,
  signal: AbortSignal,
  terminator: ExternalProcessTerminatorApi,
): Promise<SubtitleTranslationSession> {
  const server = await startLlamaServer(runtime, signal, terminator);
  return {
    translate: (prompt, maximumTokens, translateSignal) =>
      translateCue(server, prompt, maximumTokens, translateSignal),
    close: () => server.stop(),
  };
}

export class MediaSubtitleTranslationProducer
  implements AssetArtifactProducer
{
  readonly id = MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID;
  readonly version = MEDIA_SUBTITLE_TRANSLATION_PRODUCER_VERSION;
  private readonly dependencies: MediaSubtitleTranslationProducerDependencies;

  constructor(
    private readonly runtimes: MediaSubtitleRuntimeResolverApi,
    private readonly onProgress: SubtitleTranslationProgressListener,
    dependencies: Partial<MediaSubtitleTranslationProducerDependencies> = {},
  ) {
    const terminate =
      dependencies.terminate ?? new ExternalProcessTerminator();
    this.dependencies = {
      now: dependencies.now ?? Date.now,
      terminate,
      startSession:
        dependencies.startSession ??
        ((runtime, signal) =>
          startTranslationSession(runtime, signal, terminate)),
    };
  }

  async produce(
    request: AssetArtifactProduceRequest,
    signal: AbortSignal,
  ): Promise<ProducedAssetArtifact> {
    if (request.source.mediaType !== SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    const languages = parseTranslationArtifactKey(request.artifactKey);

    try {
      const source = JSON.parse(
        await readFile(request.source.absolutePath, 'utf8'),
      ) as unknown;
      if (
        !isSubtitleSourceTrackV1(source) ||
        source.language !== languages.sourceLanguage
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const runtime = await this.runtimes.requireQualityTranslation();
      const session = await this.dependencies.startSession(runtime, signal);
      const translations = new Array<SubtitleTranslationCueV1>(source.cues.length);
      let nextIndex = 0;
      let completedCues = 0;

      try {
        const worker = async () => {
          while (nextIndex < source.cues.length) {
            signal.throwIfAborted();
            const index = nextIndex++;
            const sourceCue = source.cues[index];
            const text = await session.translate(
              createHyMtCuePrompt(
                source.cues,
                index,
                languages.sourceLanguage,
                languages.targetLanguage,
              ),
              Math.min(512, Math.max(64, sourceCue.text.length * 3)),
              signal,
            );
            const cue = { sourceCueId: sourceCue.id, text };
            translations[index] = cue;
            completedCues += 1;
            this.onProgress({
              assetId: request.source.assetId,
              sourceTrackRevision: request.source.revision,
              cue,
              completedCues,
              totalCues: source.cues.length,
            });
          }
        };
        await Promise.all(
          Array.from(
            { length: Math.min(TRANSLATION_CONCURRENCY, source.cues.length) },
            worker,
          ),
        );
      } finally {
        await session.close();
      }

      if (translations.some((cue) => !cue)) {
        throw new Error('字幕翻译结果不完整');
      }
      const track: SubtitleTranslationTrackV1 = {
        version: 1,
        kind: 'subtitle-translation',
        sourceTrackRevision: request.source.revision,
        sourceLanguage: languages.sourceLanguage,
        targetLanguage: languages.targetLanguage,
        profile: 'quality',
        engine: {
          id: 'hy-mt2-llama.cpp',
          version: mediaSubtitleDependencyVersions.llama,
          model: 'Hy-MT2-1.8B-Q4_K_M',
          backend: runtime.backend,
        },
        generatedTime: this.dependencies.now(),
        cues: translations,
      };
      const filePath = join(request.stagingDirectory, 'translation.json');
      await writeFile(filePath, `${JSON.stringify(track, null, 2)}\n`, 'utf8');
      return {
        filePath,
        mediaType: SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
        extension: 'json',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (
        error instanceof AppError &&
        (error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED' ||
          error.code === 'DATA_INTEGRITY_ERROR')
      ) {
        throw error;
      }
      throw translationFailure(error);
    }
  }
}
