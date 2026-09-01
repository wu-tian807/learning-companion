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
  MossSubtitleRuntime,
  SenseVoiceSubtitleRuntime,
} from './external-libraries/media-subtitle-runtime';
import { MOSS_TRANSCRIPTION_WORKER_SOURCE } from './moss-transcription-worker-source';
import {
  addPostHocSpeakerAnalysis,
  parseMossTranscriptionWorkerOutput,
  parseSenseVoiceTranscription,
  parseSherpaSpeakerDiarization,
} from './transcription-output-adapter';

export const MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID =
  'builtin.media-subtitles.transcription';
export const MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY = 'source.auto';
export const MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_VERSION = '4';

const PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export interface MediaSubtitleTranscriptionProducerDependencies {
  readonly now: () => number;
  readonly commandRunner: ExternalCommandRunnerApi;
  readonly logicalCpuCount: number;
}

function processingFailure(error: unknown): AppError {
  return new AppError('MEDIA_SUBTITLE_PROCESSING_FAILED', { cause: error });
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
    return this.runtimes.withRuntime(signal, (runtime, usageSignal) =>
      this.produceWithRuntime(request, runtime, usageSignal),
    );
  }

  private async produceWithRuntime(
    request: AssetArtifactProduceRequest,
    runtime: MediaSubtitleRuntime,
    signal: AbortSignal,
  ): Promise<ProducedAssetArtifact> {
    try {
      const normalizedPath = join(
        request.stagingDirectory,
        runtime.transcription.kind === 'moss' ? 'audio.f32le' : 'audio.wav',
      );
      await this.normalizeAudio(
        request,
        runtime,
        normalizedPath,
        signal,
      );
      const track =
        runtime.transcription.kind === 'moss'
          ? await this.transcribeMoss(
              request,
              runtime.transcription,
              normalizedPath,
              signal,
            )
          : await this.transcribeSenseVoice(
              request,
              runtime.transcription,
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

  private async normalizeAudio(
    request: AssetArtifactProduceRequest,
    runtime: MediaSubtitleRuntime,
    normalizedPath: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.dependencies.commandRunner.run({
      command: runtime.decoder.ffmpegPath,
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
        ...(runtime.transcription.kind === 'moss'
          ? ['-c:a', 'pcm_f32le', '-f', 'f32le']
          : ['-c:a', 'pcm_s16le']),
        normalizedPath,
      ],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
    });
  }

  private async transcribeMoss(
    request: AssetArtifactProduceRequest,
    runtime: MossSubtitleRuntime,
    normalizedPath: string,
    signal: AbortSignal,
  ): Promise<SubtitleSourceTrackV1> {
    const workerPath = join(request.stagingDirectory, 'transcribe-moss.py');
    const outputPath = join(request.stagingDirectory, 'moss-result.json');
    await writeFile(workerPath, MOSS_TRANSCRIPTION_WORKER_SOURCE, 'utf8');
    await this.dependencies.commandRunner.run({
      command: runtime.pythonPath,
      args: [
        workerPath,
        '--model',
        runtime.modelPath,
        '--input',
        normalizedPath,
        '--output',
        outputPath,
        '--backend',
        runtime.backend,
        '--threads',
        String(Math.max(4, Math.floor(this.dependencies.logicalCpuCount / 2))),
      ],
      cwd: request.stagingDirectory,
      env: runtime.environment,
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
      outputLimit: 1024 * 1024,
    });
    const output = parseMossTranscriptionWorkerOutput(
      JSON.parse(await readFile(outputPath, 'utf8')),
    );
    return {
      version: 1,
      kind: 'subtitle-source',
      sourceRevision: request.source.revision,
      language: output.language,
      origin: 'asr',
      engine: {
        id: 'transcribe.cpp',
        version: mediaSubtitleDependencyVersions.moss,
        model: 'MOSS-Transcribe-Diarize-Q5_K_M',
        backend: runtime.backend,
      },
      speakerAnalysis: output.speakerAnalysis,
      generatedTime: this.dependencies.now(),
      cues: output.cues,
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
        '-m',
        runtime.modelPath,
        '-a',
        normalizedPath,
        '--vad',
        runtime.vadModelPath,
        '--backend',
        'cpu',
        '--keep-tags',
      ],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
    });
    const transcription = parseSenseVoiceTranscription(
      vad.stdout,
      recognition.stdout,
    );
    const diarization = await this.dependencies.commandRunner.run({
      command: runtime.speakerDiarizationExecutablePath,
      args: [
        '--clustering.cluster-threshold=0.7',
        `--segmentation.pyannote-model=${runtime.speakerSegmentationModelPath}`,
        `--embedding.model=${runtime.speakerEmbeddingModelPath}`,
        `--segmentation.num-threads=${Math.max(1, Math.floor(this.dependencies.logicalCpuCount / 2))}`,
        `--embedding.num-threads=${Math.max(1, Math.floor(this.dependencies.logicalCpuCount / 2))}`,
        normalizedPath,
      ],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
      outputLimit: 1024 * 1024,
    });
    const attributed = addPostHocSpeakerAnalysis(
      transcription.cues,
      parseSherpaSpeakerDiarization(
        `${diarization.stdout}\n${diarization.stderr}`,
      ),
    );
    return {
      version: 1,
      kind: 'subtitle-source',
      sourceRevision: request.source.revision,
      language: transcription.language,
      origin: 'asr',
      engine: {
        id: 'funasr-llama.cpp+sherpa-onnx',
        version: `${mediaSubtitleDependencyVersions.senseVoice}/${mediaSubtitleDependencyVersions.sherpaOnnx}`,
        model: 'sensevoice-small-q8+pyannote3-campplus',
        backend: 'cpu-avx2',
      },
      speakerAnalysis: attributed.speakerAnalysis,
      generatedTime: this.dependencies.now(),
      cues: attributed.cues,
    };
  }
}
