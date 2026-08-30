import { join } from 'node:path';

import type {
  ExternalLibraryRuntime,
  ExternalLibraryServiceApi,
} from '../../../main/external-libraries/external-library-service';
import {
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
  MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
} from './definitions';

export type SubtitleTranscriptionProfile = 'cpu' | 'nvidia';

export interface WhisperSubtitleRuntime {
  readonly kind: 'whisper';
  readonly profile: 'nvidia';
  readonly executablePath: string;
  readonly modelPath: string;
  readonly vadModelPath: string;
}

export interface MediaDecoderRuntime {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
}

export interface SenseVoiceSubtitleRuntime {
  readonly kind: 'sensevoice';
  readonly profile: 'cpu';
  readonly executablePath: string;
  readonly vadExecutablePath: string;
  readonly modelPath: string;
  readonly vadModelPath: string;
}

export type SubtitleTranscriptionRuntime =
  SenseVoiceSubtitleRuntime | WhisperSubtitleRuntime;

export interface MediaSubtitleRuntime {
  readonly decoder: MediaDecoderRuntime;
  readonly transcription: SubtitleTranscriptionRuntime;
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

function runtimePath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split('/'));
}

export class MediaSubtitleRuntimeResolver implements MediaSubtitleRuntimeResolverApi {
  constructor(private readonly externalLibraries: ExternalLibraryServiceApi) {}

  private requireSuite(runtime: ExternalLibraryRuntime) {
    if (
      runtime.variantId !== MEDIA_SUBTITLE_CPU_VARIANT_ID &&
      runtime.variantId !== MEDIA_SUBTITLE_NVIDIA_VARIANT_ID
    ) {
      throw new Error('媒体字幕组件缺少有效的 CPU/GPU 档位');
    }

    return runtime;
  }

  async requireMediaDecoder(): Promise<MediaDecoderRuntime> {
    const runtime = this.requireSuite(
      await this.externalLibraries.requireRuntime(
        MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
      ),
    );
    return this.resolveMediaDecoder(runtime);
  }

  private resolveMediaDecoder(
    runtime: ExternalLibraryRuntime,
  ): MediaDecoderRuntime {
    const binaryDirectory = runtimePath(
      runtime.runtimeDirectory,
      'decoder/engine/ffmpeg-8.1.2-essentials_build/bin',
    );

    return Object.freeze({
      ffmpegPath: join(binaryDirectory, 'ffmpeg.exe'),
      ffprobePath: join(binaryDirectory, 'ffprobe.exe'),
    });
  }

  async requireTranscription(): Promise<SubtitleTranscriptionRuntime> {
    const runtime = this.requireSuite(
      await this.externalLibraries.requireRuntime(
        MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
      ),
    );
    return this.resolveTranscription(runtime);
  }

  private resolveTranscription(
    runtime: ExternalLibraryRuntime,
  ): SubtitleTranscriptionRuntime {
    return runtime.variantId === MEDIA_SUBTITLE_NVIDIA_VARIANT_ID
      ? Object.freeze({
          kind: 'whisper' as const,
          profile: 'nvidia' as const,
          executablePath: runtimePath(
            runtime.runtimeDirectory,
            'transcription/whisper/engine/Release/whisper-cli.exe',
          ),
          modelPath: runtimePath(
            runtime.runtimeDirectory,
            'transcription/whisper/models/ggml-large-v3-turbo-q5_0.bin',
          ),
          vadModelPath: runtimePath(
            runtime.runtimeDirectory,
            'transcription/whisper/models/ggml-silero-v6.2.0.bin',
          ),
        })
      : Object.freeze({
          kind: 'sensevoice' as const,
          profile: 'cpu' as const,
          executablePath: runtimePath(
            runtime.runtimeDirectory,
            'transcription/sensevoice/engine/llama-funasr-sensevoice.exe',
          ),
          vadExecutablePath: runtimePath(
            runtime.runtimeDirectory,
            'transcription/sensevoice/engine/llama-funasr-vad.exe',
          ),
          modelPath: runtimePath(
            runtime.runtimeDirectory,
            'transcription/sensevoice/models/sensevoice-small-q8.gguf',
          ),
          vadModelPath: runtimePath(
            runtime.runtimeDirectory,
            'transcription/sensevoice/models/fsmn-vad.gguf',
          ),
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
          }),
          usageSignal,
        );
      },
    );
  }
}
