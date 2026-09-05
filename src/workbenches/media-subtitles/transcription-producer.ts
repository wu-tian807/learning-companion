import { readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
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
  type SubtitleEngineV1,
  type SubtitleSourceTrackV1,
} from './contracts';
import { mediaSubtitleDependencyVersions } from './external-libraries/definitions';
import type {
  MediaSubtitleRuntime,
  MediaSubtitleRuntimeResolverApi,
  SenseVoiceSubtitleRuntime,
  WhisperSubtitleRuntime,
} from './external-libraries/media-subtitle-runtime';
import { analyzeMediaSpeakers } from './speaker-diarization';
import {
  SubtitleTrackValidationError,
  serializeSubtitleSourceTrack,
  validateSubtitleSourceTrackForCommit,
} from './subtitle-artifact-files';
import {
  addPostHocSpeakerAnalysis,
  parseSenseVoiceStreamingTranscription,
  parseSenseVoiceTranscription,
  parseWhisperStreamingCues,
  parseWhisperTranscription,
  parseWhisperVadTimeline,
  type ParsedTranscriptionOutput,
  whisperTranscriptionNeedsAlignment,
} from './transcription-output-adapter';
import type { SubtitleTranscriptionProgressHub } from './transcription-progress';

export const MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID =
  'builtin.media-subtitles.transcription';
export const MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY = 'source.auto';
export const MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_VERSION = '7';

const PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export interface MediaSubtitleTranscriptionProducerDependencies {
  readonly now: () => number;
  readonly commandRunner: ExternalCommandRunnerApi;
  readonly logicalCpuCount: number;
  readonly progress?: SubtitleTranscriptionProgressHub;
}

function processingFailure(error: unknown): AppError {
  return new AppError('MEDIA_SUBTITLE_PROCESSING_FAILED', { cause: error });
}

export class MediaSubtitleTranscriptionProducer implements AssetArtifactProducer {
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
      progress: dependencies.progress,
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
      const audioPath = join(request.stagingDirectory, 'audio.wav');
      await this.dependencies.commandRunner.run({
        command: runtime.decoder.ffmpegPath,
        args: [
          '-hide_banner', '-loglevel', 'error',
          '-y',
          '-i', request.source.absolutePath,
          '-vn', '-ar', '16000', '-ac', '1',
          '-c:a', 'pcm_s16le',
          audioPath,
        ],
        timeoutMs: PROCESS_TIMEOUT_MS,
        signal,
      });

      const output =
        runtime.transcription.kind === 'whisper'
          ? await this.transcribeWhisper(
              request,
              runtime.transcription,
              audioPath,
              signal,
            )
          : await this.transcribeSenseVoice(
              request,
              runtime.transcription,
              audioPath,
              signal,
            );
      if (output.cues.length === 0) throw new Error('没有识别到字幕');

      this.publishProgress(request, runtime.transcription, output, 'transcribing');

      let speakerOutput:
        | ReturnType<typeof addPostHocSpeakerAnalysis>
        | undefined;
      if (request.source.mediaType.startsWith('audio/')) {
        this.publishProgress(
          request,
          runtime.transcription,
          output,
          'diarizing',
        );
        speakerOutput = addPostHocSpeakerAnalysis(
          output.cues,
          await analyzeMediaSpeakers({
            runtime: runtime.speakerDiarization,
            audioPath,
            commandRunner: this.dependencies.commandRunner,
            logicalCpuCount: this.dependencies.logicalCpuCount,
            signal,
          }),
        );
      }
      const track: SubtitleSourceTrackV1 = {
        version: 1,
        kind: 'subtitle-source',
        sourceRevision: request.source.revision,
        language: output.language,
        origin: 'asr',
        engine: this.engine(runtime.transcription),
        ...(speakerOutput
          ? { speakerAnalysis: speakerOutput.speakerAnalysis }
          : {}),
        generatedTime: this.dependencies.now(),
        cues: speakerOutput?.cues ?? output.cues,
      };
      validateSubtitleSourceTrackForCommit(track);
      const filePath = join(request.stagingDirectory, 'subtitles.json');
      await writeFile(filePath, serializeSubtitleSourceTrack(track), 'utf8');
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
      if (error instanceof SubtitleTrackValidationError) {
        throw error;
      }
      throw processingFailure(error);
    }
  }

  private engine(
    runtime: WhisperSubtitleRuntime | SenseVoiceSubtitleRuntime,
  ): SubtitleEngineV1 {
    return runtime.kind === 'whisper'
      ? {
          id: 'whisper.cpp',
          version: mediaSubtitleDependencyVersions.whisper,
          model: 'large-v3-turbo-q5_0',
          backend: 'cuda',
        }
      : {
          id: 'funasr-llama.cpp',
          version: mediaSubtitleDependencyVersions.senseVoice,
          model: 'sensevoice-small-q8',
          backend: 'cpu-avx2',
        };
  }

  private publishProgress(
    request: AssetArtifactProduceRequest,
    runtime: WhisperSubtitleRuntime | SenseVoiceSubtitleRuntime,
    output: ParsedTranscriptionOutput,
    stage: 'transcribing' | 'diarizing',
  ): void {
    if (!this.dependencies.progress || output.cues.length === 0) return;
    this.dependencies.progress.publish({
      assetId: request.source.assetId,
      sourceRevision: request.source.revision,
      stage,
      track: {
        version: 1,
        kind: 'subtitle-source',
        sourceRevision: request.source.revision,
        language: output.language,
        origin: 'asr',
        engine: this.engine(runtime),
        generatedTime: this.dependencies.now(),
        cues: output.cues,
      },
    });
  }

  private async transcribeWhisper(
    request: AssetArtifactProduceRequest,
    runtime: WhisperSubtitleRuntime,
    audioPath: string,
    signal: AbortSignal,
  ): Promise<ParsedTranscriptionOutput> {
    const outputPrefix = join(request.stagingDirectory, 'whisper');
    let stdout = '';
    let stderr = '';
    let publishedFingerprint = '';
    const publishStreamingOutput = () => {
      const cues = parseWhisperStreamingCues(`${stdout}\n${stderr}`);
      const fingerprint = JSON.stringify(cues);
      if (cues.length === 0 || fingerprint === publishedFingerprint) return;
      publishedFingerprint = fingerprint;
      this.publishProgress(
        request,
        runtime,
        { language: 'unknown', cues },
        'transcribing',
      );
    };
    const process = await this.dependencies.commandRunner.run({
      command: runtime.executablePath,
      args: [
        '-m', runtime.modelPath,
        '-f', audioPath,
        '-l', 'auto',
        '-t', String(Math.max(4, Math.floor(this.dependencies.logicalCpuCount / 2))),
        '-fa',
        '-ojf',
        '-of', outputPrefix,
        '--vad',
        '-vm', runtime.vadModelPath,
        '-pp',
      ],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
      onStdout: (content) => {
        stdout += content;
        publishStreamingOutput();
      },
      onStderr: (content) => {
        stderr += content;
        publishStreamingOutput();
      },
    });
    const commandOutput = `${stdout}\n${stderr}\n${process.stdout}\n${process.stderr}`;
    const value = JSON.parse(await readFile(`${outputPrefix}.json`, 'utf8'));
    const vadTimeline = parseWhisperVadTimeline(commandOutput);
    if (
      vadTimeline.length === 0 ||
      whisperTranscriptionNeedsAlignment(value)
    ) {
      return this.transcribeWhisperAligned(request, runtime, audioPath, signal);
    }
    return parseWhisperTranscription(value, vadTimeline);
  }

  private async transcribeWhisperAligned(
    request: AssetArtifactProduceRequest,
    runtime: WhisperSubtitleRuntime,
    audioPath: string,
    signal: AbortSignal,
  ): Promise<ParsedTranscriptionOutput> {
    const outputPrefix = join(request.stagingDirectory, 'whisper-aligned');
    await this.dependencies.commandRunner.run({
      command: runtime.executablePath,
      args: [
        '-m', runtime.modelPath,
        '-f', audioPath,
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
    return parseWhisperTranscription(
      JSON.parse(await readFile(`${outputPrefix}.json`, 'utf8')),
    );
  }

  private async transcribeSenseVoice(
    request: AssetArtifactProduceRequest,
    runtime: SenseVoiceSubtitleRuntime,
    audioPath: string,
    signal: AbortSignal,
  ): Promise<ParsedTranscriptionOutput> {
    const vad = await this.dependencies.commandRunner.run({
      command: runtime.vadExecutablePath,
      args: ['-m', runtime.vadModelPath, '-a', audioPath],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
    });
    let recognitionOutput = '';
    let publishedFingerprint = '';
    const publishStreamingOutput = () => {
      const output = parseSenseVoiceStreamingTranscription(
        vad.stdout,
        recognitionOutput,
      );
      if (!output) return;
      const fingerprint = JSON.stringify(output.cues);
      if (fingerprint === publishedFingerprint) return;
      publishedFingerprint = fingerprint;
      this.publishProgress(
        request,
        runtime,
        output,
        'transcribing',
      );
    };
    const recognition = await this.dependencies.commandRunner.run({
      command: runtime.executablePath,
      args: [
        '-m', runtime.modelPath,
        '-a', audioPath,
        '--vad', runtime.vadModelPath,
        '--backend', 'cpu',
        '--keep-tags',
      ],
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
      onStdout: (content) => {
        recognitionOutput += content;
        publishStreamingOutput();
      },
    });
    return parseSenseVoiceTranscription(vad.stdout, recognition.stdout);
  }
}
