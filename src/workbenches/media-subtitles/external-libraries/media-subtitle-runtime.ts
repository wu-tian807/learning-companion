import { delimiter, join } from 'node:path';

import type {
  ExternalLibraryRuntime,
  ExternalLibraryServiceApi,
} from '../../../main/external-libraries/external-library-service';
import {
  MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID,
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
  MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
  type MediaSubtitleVariantId,
} from './definitions';

export type SubtitleTranscriptionProfile = MediaSubtitleVariantId;

export interface MossSubtitleRuntime {
  readonly kind: 'moss';
  readonly profile: 'nvidia' | 'apple-silicon';
  readonly backend: 'cuda' | 'metal';
  readonly pythonPath: string;
  readonly pythonPackagesPath: string;
  readonly nativeLibraryPath: string;
  readonly modelPath: string;
  readonly environment: NodeJS.ProcessEnv;
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
  readonly speakerDiarizationExecutablePath: string;
  readonly speakerSegmentationModelPath: string;
  readonly speakerEmbeddingModelPath: string;
}

export type SubtitleTranscriptionRuntime =
  | SenseVoiceSubtitleRuntime
  | MossSubtitleRuntime;

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

function isSubtitleVariant(value: unknown): value is MediaSubtitleVariantId {
  return (
    value === MEDIA_SUBTITLE_CPU_VARIANT_ID ||
    value === MEDIA_SUBTITLE_NVIDIA_VARIANT_ID ||
    value === MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID
  );
}

export class MediaSubtitleRuntimeResolver
  implements MediaSubtitleRuntimeResolverApi
{
  constructor(private readonly externalLibraries: ExternalLibraryServiceApi) {}

  private requireSuite(runtime: ExternalLibraryRuntime): ExternalLibraryRuntime & {
    readonly variantId: MediaSubtitleVariantId;
  } {
    if (!isSubtitleVariant(runtime.variantId)) {
      throw new Error('媒体字幕组件缺少有效的硬件档位');
    }
    return runtime as ExternalLibraryRuntime & {
      readonly variantId: MediaSubtitleVariantId;
    };
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
    runtime: ExternalLibraryRuntime & { readonly variantId: MediaSubtitleVariantId },
  ): MediaDecoderRuntime {
    const binaryDirectory =
      runtime.variantId === MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID
        ? runtimePath(runtime.runtimeDirectory, 'decoder/engine')
        : runtimePath(
            runtime.runtimeDirectory,
            'decoder/engine/ffmpeg-8.1.2-essentials_build/bin',
          );
    return Object.freeze({
      ffmpegPath: join(
        binaryDirectory,
        runtime.variantId === MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID
          ? 'ffmpeg'
          : 'ffmpeg.exe',
      ),
      ffprobePath: join(
        binaryDirectory,
        runtime.variantId === MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID
          ? 'ffprobe'
          : 'ffprobe.exe',
      ),
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
    runtime: ExternalLibraryRuntime & { readonly variantId: MediaSubtitleVariantId },
  ): SubtitleTranscriptionRuntime {
    if (runtime.variantId === MEDIA_SUBTITLE_CPU_VARIANT_ID) {
      return Object.freeze({
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
        speakerDiarizationExecutablePath: runtimePath(
          runtime.runtimeDirectory,
          'speaker/engine/sherpa-onnx-v1.13.2-win-x64-shared-MD-Release-no-tts/bin/sherpa-onnx-offline-speaker-diarization.exe',
        ),
        speakerSegmentationModelPath: runtimePath(
          runtime.runtimeDirectory,
          'speaker/models/pyannote-segmentation-3.0.int8.onnx',
        ),
        speakerEmbeddingModelPath: runtimePath(
          runtime.runtimeDirectory,
          'speaker/models/3dspeaker-campplus-zh-en.onnx',
        ),
      });
    }

    const windows = runtime.variantId === MEDIA_SUBTITLE_NVIDIA_VARIANT_ID;
    const nativeDirectory = runtimePath(
      runtime.runtimeDirectory,
      windows
        ? 'transcription/moss/engine/transcribe-native-windows-x86_64-cuda'
        : 'transcription/moss/engine/transcribe-native-macos-arm64-metal',
    );
    const pythonPackagesPath = runtimePath(
      runtime.runtimeDirectory,
      'transcription/moss/python-packages',
    );
    const windowsCudaPaths = windows
      ? [
          runtimePath(
            runtime.runtimeDirectory,
            'transcription/moss/cuda-cublas/nvidia/cublas/bin',
          ),
          runtimePath(
            runtime.runtimeDirectory,
            'transcription/moss/cuda-core/nvidia/cuda_runtime/bin',
          ),
        ]
      : [];
    return Object.freeze({
      kind: 'moss' as const,
      profile: windows ? ('nvidia' as const) : ('apple-silicon' as const),
      backend: windows ? ('cuda' as const) : ('metal' as const),
      pythonPath: runtimePath(
        runtime.runtimeDirectory,
        windows
          ? 'transcription/moss/python-runtime/python/python.exe'
          : 'transcription/moss/python-runtime/python/bin/python3.12',
      ),
      pythonPackagesPath,
      nativeLibraryPath: join(
        nativeDirectory,
        windows ? 'transcribe.dll' : 'libtranscribe.dylib',
      ),
      modelPath: runtimePath(
        runtime.runtimeDirectory,
        'transcription/moss/models/MOSS-Transcribe-Diarize-Q5_K_M.gguf',
      ),
      environment: Object.freeze({
        ...process.env,
        PYTHONNOUSERSITE: '1',
        PYTHONPATH: pythonPackagesPath,
        TRANSCRIBE_LIBRARY: join(
          nativeDirectory,
          windows ? 'transcribe.dll' : 'libtranscribe.dylib',
        ),
        ...(windows
          ? {
              PATH: [
                nativeDirectory,
                ...windowsCudaPaths,
                process.env.PATH ?? '',
              ].join(delimiter),
            }
          : {
              DYLD_LIBRARY_PATH: [
                nativeDirectory,
                process.env.DYLD_LIBRARY_PATH ?? '',
              ].join(delimiter),
            }),
      }),
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
