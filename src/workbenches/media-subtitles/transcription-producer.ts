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
  type SubtitleSourceTrackV1,
} from './contracts';
import { mediaSubtitleDependencyVersions } from './external-libraries/definitions';
import type {
  MediaSubtitleRuntimeResolverApi,
  MediaSubtitleRuntime,
  SenseVoiceSubtitleRuntime,
  WhisperSubtitleRuntime,
} from './external-libraries/media-subtitle-runtime';
import {
  parseSenseVoiceTranscription,
  parseWhisperTranscription,
} from './transcription-output-adapter';

export const MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID =
  'builtin.media-subtitles.transcription';
export const MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY = 'source.auto';
export const MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_VERSION = '3';

const PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

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

    return this.runtimes.withRuntime(
      signal,
      (runtime, usageSignal) =>
        this.produceWithRuntime(request, runtime, usageSignal),
    );
  }

  private async produceWithRuntime(
    request: AssetArtifactProduceRequest,
    runtime: MediaSubtitleRuntime,
    signal: AbortSignal,
  ): Promise<ProducedAssetArtifact> {
    try {
      const { decoder, transcription } = runtime;
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
        '-nfa',
        '-dtw', 'large.v3.turbo',
        '-ojf',
        '-of', outputPrefix,
      ],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
    });
    const output = parseWhisperTranscription(JSON.parse(
      await readFile(`${outputPrefix}.json`, 'utf8'),
    ));
    const { language, cues } = output;
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
    const { language, cues } = parseSenseVoiceTranscription(
      vad.stdout,
      recognition.stdout,
    );
    if (cues.length === 0) throw new Error('SenseVoice 没有识别到字幕');

    return {
      version: 1,
      kind: 'subtitle-source',
      sourceRevision: request.source.revision,
      language,
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
