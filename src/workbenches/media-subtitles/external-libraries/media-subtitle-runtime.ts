import { join } from 'node:path';

import type { ExternalLibraryServiceApi } from '../../../main/external-libraries/external-library-service';
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
  | SenseVoiceSubtitleRuntime
  | WhisperSubtitleRuntime;

export interface BergamotSubtitleRuntime {
  readonly modelsDirectory: string;
  readonly enToZh: {
    readonly modelPath: string;
    readonly shortlistPath: string;
    readonly sourceVocabularyPath: string;
    readonly targetVocabularyPath: string;
  };
  readonly zhToEn: {
    readonly modelPath: string;
    readonly shortlistPath: string;
    readonly vocabularyPath: string;
  };
}

export interface HyMtSubtitleRuntime {
  readonly executablePath: string;
  readonly modelPath: string;
  readonly backend: 'cpu' | 'vulkan';
}

export interface MediaSubtitleRuntimeResolverApi {
  requireMediaDecoder(): Promise<MediaDecoderRuntime>;
  requireTranscription(): Promise<SubtitleTranscriptionRuntime>;
  requireFastTranslation(): Promise<BergamotSubtitleRuntime>;
  requireQualityTranslation(): Promise<HyMtSubtitleRuntime>;
}

function runtimePath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split('/'));
}

export class MediaSubtitleRuntimeResolver
  implements MediaSubtitleRuntimeResolverApi
{
  constructor(
    private readonly externalLibraries: ExternalLibraryServiceApi,
  ) {}

  private async requireSuite() {
    const runtime = await this.externalLibraries.requireRuntime(
      MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    );
    if (
      runtime.variantId !== MEDIA_SUBTITLE_CPU_VARIANT_ID &&
      runtime.variantId !== MEDIA_SUBTITLE_NVIDIA_VARIANT_ID
    ) {
      throw new Error('媒体字幕组件缺少有效的 CPU/GPU 档位');
    }

    return runtime;
  }

  async requireMediaDecoder(): Promise<MediaDecoderRuntime> {
    const runtime = await this.requireSuite();
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
    const runtime = await this.requireSuite();
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

  async requireFastTranslation(): Promise<BergamotSubtitleRuntime> {
    const { runtimeDirectory } = await this.requireSuite();
    const modelsDirectory = runtimePath(
      runtimeDirectory,
      'translation/bergamot',
    );

    return Object.freeze({
      modelsDirectory,
      enToZh: Object.freeze({
        modelPath: runtimePath(modelsDirectory, 'en-zh/model.bin'),
        shortlistPath: runtimePath(
          modelsDirectory,
          'en-zh/shortlist.bin',
        ),
        sourceVocabularyPath: runtimePath(
          modelsDirectory,
          'en-zh/srcVocab.bin',
        ),
        targetVocabularyPath: runtimePath(
          modelsDirectory,
          'en-zh/trgVocab.bin',
        ),
      }),
      zhToEn: Object.freeze({
        modelPath: runtimePath(modelsDirectory, 'zh-en/model.bin'),
        shortlistPath: runtimePath(
          modelsDirectory,
          'zh-en/shortlist.bin',
        ),
        vocabularyPath: runtimePath(
          modelsDirectory,
          'zh-en/vocab.bin',
        ),
      }),
    });
  }

  async requireQualityTranslation(): Promise<HyMtSubtitleRuntime> {
    const runtime = await this.requireSuite();

    return Object.freeze({
      executablePath: runtimePath(
        runtime.runtimeDirectory,
        'translation/hymt/engine/llama-server.exe',
      ),
      modelPath: runtimePath(
        runtime.runtimeDirectory,
        'translation/hymt/models/Hy-MT2-1.8B-Q4_K_M.gguf',
      ),
      backend:
        runtime.variantId === MEDIA_SUBTITLE_NVIDIA_VARIANT_ID
          ? 'vulkan'
          : 'cpu',
    });
  }
}
