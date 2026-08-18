import { cpus } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  AssetArtifactProduceRequest,
  AssetArtifactProducer,
  ProducedAssetArtifact,
} from '../../main/artifacts/asset-artifact-registry';
import { AppError } from '../../main/errors/app-error';
import {
  ExternalCommandRunner,
  type ExternalCommandRunnerApi,
} from '../../main/external-libraries/external-command-runner';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  type SubtitleCueV1,
  type SubtitleLanguage,
  type SubtitleSourceTrackV1,
} from './contracts';
import { mediaSubtitleDependencyVersions } from './external-libraries/definitions';
import type {
  MediaSubtitleRuntimeResolverApi,
  SenseVoiceSubtitleRuntime,
  WhisperSubtitleRuntime,
} from './external-libraries/media-subtitle-runtime';

export const MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID =
  'builtin.media-subtitles.transcription';
export const MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY = 'source.auto';
export const MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_VERSION = '1';

const PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

interface WhisperJsonSegment {
  readonly offsets?: { readonly from?: unknown; readonly to?: unknown };
  readonly text?: unknown;
}

interface WhisperJsonOutput {
  readonly result?: { readonly language?: unknown };
  readonly transcription?: readonly WhisperJsonSegment[];
}

interface SenseVoiceSegment {
  readonly language: string;
  readonly text: string;
}

interface VadSegment {
  readonly startMs: number;
  readonly endMs: number;
}

export interface MediaSubtitleTranscriptionProducerDependencies {
  readonly now: () => number;
  readonly commandRunner: ExternalCommandRunnerApi;
  readonly logicalCpuCount: number;
}

function processingFailure(error: unknown): AppError {
  return new AppError('MEDIA_SUBTITLE_PROCESSING_FAILED', {
    cause: error,
  });
}

function normalizedLanguage(value: unknown): SubtitleLanguage {
  if (typeof value !== 'string') return 'unknown';
  const language = value.trim().toLowerCase().replaceAll('_', '-');

  if (language === 'en' || language.startsWith('en-')) return 'en';
  if (
    language === 'zh' ||
    language.startsWith('zh-') ||
    language === 'chinese'
  ) {
    return 'zh-Hans';
  }
  return 'unknown';
}

function finiteTime(value: unknown): number {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error('字幕时间戳无效');
  }
  return Math.round(number);
}

function whisperCues(output: WhisperJsonOutput): readonly SubtitleCueV1[] {
  if (!Array.isArray(output.transcription)) {
    throw new Error('Whisper 没有返回 transcription 数组');
  }

  return output.transcription.flatMap((segment, index) => {
    const text = String(segment.text ?? '').replace(/\s+/gu, ' ').trim();
    if (!text) return [];
    const startMs = finiteTime(segment.offsets?.from);
    const endMs = finiteTime(segment.offsets?.to);
    if (endMs <= startMs) throw new Error('Whisper 返回了无效时间段');
    const id = `raw-${String(index + 1).padStart(6, '0')}`;
    return [{
      id,
      startMs,
      endMs,
      text,
      sourceCueIds: [id],
    }];
  });
}

function joinCueText(
  current: string,
  next: string,
  language: SubtitleLanguage,
): string {
  if (!current) return next;
  if (language !== 'zh-Hans') return `${current} ${next}`;
  const boundaryHasLatinText =
    /[\p{Letter}\p{Number}]$/u.test(current) &&
    /^(?:[A-Za-z0-9]|\p{Script=Han})/u.test(next) &&
    (/[A-Za-z0-9]$/u.test(current) || /^[A-Za-z0-9]/u.test(next));
  return `${current}${boundaryHasLatinText ? ' ' : ''}${next}`;
}

export function mergeWhisperSubtitleCues(
  source: readonly SubtitleCueV1[],
  language: SubtitleLanguage,
): readonly SubtitleCueV1[] {
  const maximumCharacters = language === 'zh-Hans' ? 64 : 180;
  const result: SubtitleCueV1[] = [];
  let group: SubtitleCueV1[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const id = `cue-${String(result.length + 1).padStart(6, '0')}`;
    result.push({
      id,
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
      text: group.reduce(
        (text, cue) => joinCueText(text, cue.text, language),
        '',
      ),
      sourceCueIds: group.flatMap(({ sourceCueIds }) => sourceCueIds),
    });
    group = [];
  };

  for (const cue of source) {
    const first = group[0];
    const previous = group[group.length - 1];
    const joinedText = group.reduce(
      (text, item) => joinCueText(text, item.text, language),
      '',
    );
    const candidateText = joinCueText(joinedText, cue.text, language);
    if (
      first &&
      previous &&
      (cue.startMs - previous.endMs > 700 ||
        cue.endMs - first.startMs > 8_000 ||
        [...candidateText].length > maximumCharacters)
    ) {
      flush();
    }
    group.push(cue);
    if (/[。！？!?…]["'”’）》】]*$/u.test(cue.text)) flush();
  }
  flush();
  return result;
}

function parseVadSegments(source: string): readonly VadSegment[] {
  const segments: VadSegment[] = [];

  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
    const startMs = Number(match[1]);
    const endMs = Number(match[2]);
    if (endMs <= startMs) {
      throw new Error('FSMN-VAD 返回了无效时间段');
    }
    segments.push({ startMs, endMs });
  }

  if (segments.length === 0) {
    throw new Error('FSMN-VAD 没有检测到语音');
  }
  return segments;
}

function parseSenseVoiceSegments(source: string): readonly SenseVoiceSegment[] {
  const pattern =
    /<\|([^|]+)\|><\|([^|]+)\|><\|([^|]+)\|><\|([^|]+)\|>([\s\S]*?)(?=<\|[^|]+\|><\|[^|]+\|><\|[^|]+\|><\|[^|]+\|>|$)/gu;
  const segments = Array.from(source.matchAll(pattern), (match) => ({
    language: match[1],
    text: match[5].replace(/\s+/gu, ' ').trim(),
  })).filter(({ text }) => text.length > 0);

  if (segments.length === 0) {
    throw new Error('SenseVoice 没有返回可用文本');
  }
  return segments;
}

function splitSubtitleText(text: string, maximum = 28): readonly string[] {
  const clauses =
    text.match(/[^，。！？!?；;,.、：:]+[，。！？!?；;,.、：:]?/gu) ?? [text];
  const result: string[] = [];
  let current = '';

  const pushOversized = (value: string) => {
    const characters = [...value];
    for (let offset = 0; offset < characters.length; offset += maximum) {
      const chunk = characters.slice(offset, offset + maximum).join('').trim();
      if (chunk) result.push(chunk);
    }
  };

  for (const clause of clauses) {
    if ([...`${current}${clause}`].length <= maximum) {
      current += clause;
      continue;
    }
    if (current.trim()) result.push(current.trim());
    current = '';
    if ([...clause].length > maximum) pushOversized(clause);
    else current = clause;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function senseVoiceCues(
  timings: readonly VadSegment[],
  recognized: readonly SenseVoiceSegment[],
): readonly SubtitleCueV1[] {
  if (timings.length !== recognized.length) {
    throw new Error(
      `SenseVoice/VAD 分段数不一致：${recognized.length}/${timings.length}`,
    );
  }

  const cues: SubtitleCueV1[] = [];
  for (let segmentIndex = 0; segmentIndex < timings.length; segmentIndex += 1) {
    const timing = timings[segmentIndex];
    const chunks = splitSubtitleText(recognized[segmentIndex].text);
    const weights = chunks.map((text) => Math.max(1, [...text].length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let consumedWeight = 0;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const startMs = timing.startMs + Math.round(
        ((timing.endMs - timing.startMs) * consumedWeight) / totalWeight,
      );
      consumedWeight += weights[chunkIndex];
      const endMs = chunkIndex === chunks.length - 1
        ? timing.endMs
        : timing.startMs + Math.round(
            ((timing.endMs - timing.startMs) * consumedWeight) / totalWeight,
          );
      const id = `cue-${String(cues.length + 1).padStart(6, '0')}`;
      cues.push({
        id,
        startMs,
        endMs,
        text: chunks[chunkIndex],
        sourceCueIds: [id],
      });
    }
  }
  return cues;
}

function senseVoiceLanguage(
  segments: readonly SenseVoiceSegment[],
): SubtitleLanguage {
  const languages = new Set(segments.map(({ language }) =>
    normalizedLanguage(language),
  ));
  return languages.size === 1 ? [...languages][0] : 'unknown';
}

export class MediaSubtitleTranscriptionProducer
  implements AssetArtifactProducer
{
  readonly id = MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID;
  readonly version = MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_VERSION;
  private readonly dependencies: MediaSubtitleTranscriptionProducerDependencies;

  constructor(
    private readonly runtimes: MediaSubtitleRuntimeResolverApi,
    dependencies: Partial<MediaSubtitleTranscriptionProducerDependencies> = {},
  ) {
    this.dependencies = {
      now: dependencies.now ?? Date.now,
      commandRunner: dependencies.commandRunner ?? new ExternalCommandRunner(),
      logicalCpuCount: dependencies.logicalCpuCount ?? cpus().length,
    };
  }

  async produce(
    request: AssetArtifactProduceRequest,
    signal: AbortSignal,
  ): Promise<ProducedAssetArtifact> {
    if (request.artifactKey !== MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    try {
      const [decoder, transcription] = await Promise.all([
        this.runtimes.requireMediaDecoder(),
        this.runtimes.requireTranscription(),
      ]);
      const normalizedPath = join(request.stagingDirectory, 'audio.wav');
      await this.dependencies.commandRunner.run({
        command: decoder.ffmpegPath,
        args: [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          request.source.absolutePath,
          '-vn',
          '-ar',
          '16000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          normalizedPath,
        ],
        timeoutMs: PROCESS_TIMEOUT_MS,
        signal,
      });

      const track = transcription.kind === 'whisper'
        ? await this.transcribeWhisper(request, transcription, normalizedPath, signal)
        : await this.transcribeSenseVoice(
            request,
            transcription,
            normalizedPath,
            signal,
          );
      const filePath = join(request.stagingDirectory, 'subtitles.json');
      await writeFile(filePath, `${JSON.stringify(track, null, 2)}\n`, 'utf8');
      return {
        filePath,
        mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
        extension: 'json',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (
        error instanceof AppError &&
        error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED'
      ) {
        throw error;
      }
      throw processingFailure(error);
    }
  }

  private async transcribeWhisper(
    request: AssetArtifactProduceRequest,
    runtime: WhisperSubtitleRuntime,
    normalizedPath: string,
    signal: AbortSignal,
  ): Promise<SubtitleSourceTrackV1> {
    const outputPrefix = join(request.stagingDirectory, 'whisper');
    await this.dependencies.commandRunner.run({
      command: runtime.executablePath,
      args: [
        '-m', runtime.modelPath,
        '-f', normalizedPath,
        '-l', 'auto',
        '-t', String(Math.max(4, Math.floor(this.dependencies.logicalCpuCount / 2))),
        '-fa',
        '-oj',
        '-of', outputPrefix,
        '--vad',
        '-vm', runtime.vadModelPath,
      ],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
    });
    const output = JSON.parse(
      await readFile(`${outputPrefix}.json`, 'utf8'),
    ) as WhisperJsonOutput;
    const language = normalizedLanguage(output.result?.language);
    const cues = mergeWhisperSubtitleCues(whisperCues(output), language);
    if (cues.length === 0) throw new Error('Whisper 没有识别到字幕');

    return {
      version: 1,
      kind: 'subtitle-source',
      sourceRevision: request.source.revision,
      language,
      origin: 'asr',
      engine: {
        id: 'whisper.cpp',
        version: mediaSubtitleDependencyVersions.whisper,
        model: 'large-v3-turbo-q5_0',
        backend: 'cuda',
      },
      generatedTime: this.dependencies.now(),
      cues,
    };
  }

  private async transcribeSenseVoice(
    request: AssetArtifactProduceRequest,
    runtime: SenseVoiceSubtitleRuntime,
    normalizedPath: string,
    signal: AbortSignal,
  ): Promise<SubtitleSourceTrackV1> {
    const vad = await this.dependencies.commandRunner.run({
      command: runtime.vadExecutablePath,
      args: ['-m', runtime.vadModelPath, '-a', normalizedPath],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
    });
    const recognition = await this.dependencies.commandRunner.run({
      command: runtime.executablePath,
      args: [
        '-m', runtime.modelPath,
        '-a', normalizedPath,
        '--vad', runtime.vadModelPath,
        '--backend', 'cpu',
        '--keep-tags',
      ],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
    });
    const recognized = parseSenseVoiceSegments(recognition.stdout);
    const cues = senseVoiceCues(parseVadSegments(vad.stdout), recognized);
    if (cues.length === 0) throw new Error('SenseVoice 没有识别到字幕');

    return {
      version: 1,
      kind: 'subtitle-source',
      sourceRevision: request.source.revision,
      language: senseVoiceLanguage(recognized),
      origin: 'asr',
      engine: {
        id: 'funasr-llama.cpp',
        version: mediaSubtitleDependencyVersions.senseVoice,
        model: 'sensevoice-small-q8',
        backend: 'cpu-avx2',
      },
      generatedTime: this.dependencies.now(),
      cues,
    };
  }
}
