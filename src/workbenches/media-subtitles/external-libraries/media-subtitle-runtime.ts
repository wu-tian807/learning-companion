import { join } from 'node:path';

import type {
  ExternalLibraryRuntime,
  ExternalLibraryServiceApi,
} from '../../../main/external-libraries/external-library-service';
import {
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
  MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
  type MediaSubtitleVariantId,
} from './definitions';

export interface WhisperSubtitleRuntime {
  readonly kind: 'whisper';
  readonly executablePath: string;
  readonly modelPath: string;
  readonly vadModelPath: string;
}

export interface SenseVoiceSubtitleRuntime {
  readonly kind: 'sensevoice';
  readonly executablePath: string;
  readonly vadExecutablePath: string;
  readonly modelPath: string;
  readonly vadModelPath: string;
}

export interface MediaDecoderRuntime {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
}

export interface SpeakerDiarizationRuntime {
  readonly executablePath: string;
  readonly segmentationModelPath: string;
  readonly embeddingModelPath: string;
}

export type SubtitleTranscriptionRuntime =
  SenseVoiceSubtitleRuntime | WhisperSubtitleRuntime;

export interface MediaSubtitleRuntime {
  readonly decoder: MediaDecoderRuntime;
  readonly transcription: SubtitleTranscriptionRuntime;
  readonly speakerDiarization: SpeakerDiarizationRuntime;
}

export interface MediaSubtitleRuntimeResolverApi {
  requireMediaDecoder(): Promise<MediaDecoderRuntime>;
  requireTranscription(): Promise<SubtitleTranscriptionRuntime>;
  withRuntime<T>(
    signal: AbortSignal | undefined,
    operation: (
      runtime: MediaSubtitleRuntime,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T>;
}

function runtimePath(
  runtime: ExternalLibraryRuntime,
  relativePath: string,
): string {
  return join(runtime.runtimeDirectory, ...relativePath.split('/'));
}

export class MediaSubtitleRuntimeResolver implements MediaSubtitleRuntimeResolverApi {
  constructor(private readonly externalLibraries: ExternalLibraryServiceApi) {}

  private requireSuite(
    runtime: ExternalLibraryRuntime,
  ): ExternalLibraryRuntime & {
    readonly variantId: MediaSubtitleVariantId;
  } {
    if (
      runtime.variantId !== MEDIA_SUBTITLE_CPU_VARIANT_ID &&
      runtime.variantId !== MEDIA_SUBTITLE_NVIDIA_VARIANT_ID
    ) {
      throw new Error('媒体字幕组件缺少有效的 CPU/GPU 档位');
    }
    return runtime as ExternalLibraryRuntime & {
      readonly variantId: MediaSubtitleVariantId;
    };
  }

  private async requireSuiteRuntime(): Promise<
    ExternalLibraryRuntime & { readonly variantId: MediaSubtitleVariantId }
  > {
    return this.requireSuite(
      await this.externalLibraries.requireRuntime(
        MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
      ),
    );
  }

  async requireMediaDecoder(): Promise<MediaDecoderRuntime> {
    return this.resolveMediaDecoder(await this.requireSuiteRuntime());
  }

  async requireTranscription(): Promise<SubtitleTranscriptionRuntime> {
    return this.resolveTranscription(await this.requireSuiteRuntime());
  }

  private resolveMediaDecoder(
    runtime: ExternalLibraryRuntime,
  ): MediaDecoderRuntime {
    const directory = runtimePath(
      runtime,
      'decoder/engine/ffmpeg-8.1.2-essentials_build/bin',
    );
    return Object.freeze({
      ffmpegPath: join(directory, 'ffmpeg.exe'),
      ffprobePath: join(directory, 'ffprobe.exe'),
    });
  }

  private resolveTranscription(
    runtime: ExternalLibraryRuntime & {
      readonly variantId: MediaSubtitleVariantId;
    },
  ): SubtitleTranscriptionRuntime {
    const nvidia = runtime.variantId === MEDIA_SUBTITLE_NVIDIA_VARIANT_ID;
    const root = runtimePath(
      runtime,
      `transcription/${nvidia ? 'whisper' : 'sensevoice'}`,
    );
    return nvidia
      ? Object.freeze({
          kind: 'whisper' as const,
          executablePath: join(root, 'engine', 'Release', 'whisper-cli.exe'),
          modelPath: join(root, 'models', 'ggml-large-v3-turbo-q5_0.bin'),
          vadModelPath: join(root, 'models', 'ggml-silero-v6.2.0.bin'),
        })
      : Object.freeze({
          kind: 'sensevoice' as const,
          executablePath: join(root, 'engine', 'llama-funasr-sensevoice.exe'),
          vadExecutablePath: join(root, 'engine', 'llama-funasr-vad.exe'),
          modelPath: join(root, 'models', 'sensevoice-small-q8.gguf'),
          vadModelPath: join(root, 'models', 'fsmn-vad.gguf'),
        });
  }

  private resolveSpeakerDiarization(
    runtime: ExternalLibraryRuntime,
  ): SpeakerDiarizationRuntime {
    const root = runtimePath(runtime, 'speaker');
    return Object.freeze({
      executablePath: join(
        root,
        'engine',
        'sherpa-onnx-v1.13.2-win-x64-shared-MD-Release-no-tts',
        'bin',
        'sherpa-onnx-offline-speaker-diarization.exe',
      ),
      segmentationModelPath: join(root, 'models', 'pyannote-segmentation-3.0.int8.onnx'),
      embeddingModelPath: join(root, 'models', '3dspeaker-campplus-zh-en.onnx'),
    });
  }

  withRuntime<T>(
    signal: AbortSignal | undefined,
    operation: (
      runtime: MediaSubtitleRuntime,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    return this.externalLibraries.withRuntime(
      MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
      signal,
      (runtime, usageSignal) => {
        const suite = this.requireSuite(runtime);
        return operation(
          Object.freeze({
            decoder: this.resolveMediaDecoder(suite),
            transcription: this.resolveTranscription(suite),
            speakerDiarization: this.resolveSpeakerDiarization(suite),
          }),
          usageSignal,
        );
      },
    );
  }
}
