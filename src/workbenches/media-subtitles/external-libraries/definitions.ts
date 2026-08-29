import type {
  ExternalLibraryBundlePackageDefinition,
  ExternalLibraryBundleResourceDefinition,
  ExternalLibraryDefinition,
} from '../../../main/external-libraries/external-library-definition';

export const MEDIA_SUBTITLE_SUITE_LIBRARY_ID = 'media-subtitles';
export const MEDIA_SUBTITLE_CPU_VARIANT_ID = 'cpu';
export const MEDIA_SUBTITLE_NVIDIA_VARIANT_ID = 'nvidia';

const FFMPEG_VERSION = '8.1.2';
const WHISPER_VERSION = '1.9.2';
const FUNASR_RUNTIME_VERSION = '0.1.9';

function fileResource(input: {
  readonly id: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly destinationRelativePath: string;
}): ExternalLibraryBundleResourceDefinition {
  return Object.freeze({
    id: input.id,
    downloadUrl: input.downloadUrl,
    sha256: input.sha256,
    expectedSize: input.expectedSize,
    installation: Object.freeze({
      type: 'file' as const,
      destinationRelativePath: input.destinationRelativePath,
    }),
  });
}

function zipResource(input: {
  readonly id: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly destinationRelativePath: string;
}): ExternalLibraryBundleResourceDefinition {
  return Object.freeze({
    id: input.id,
    downloadUrl: input.downloadUrl,
    sha256: input.sha256,
    expectedSize: input.expectedSize,
    installation: Object.freeze({
      type: 'zip' as const,
      destinationRelativePath: input.destinationRelativePath,
    }),
  });
}

const FFMPEG_RESOURCE = zipResource({
  id: 'ffmpeg-runtime',
  downloadUrl:
    'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip',
  sha256: 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec',
  expectedSize: 109_728_040,
  destinationRelativePath: 'decoder/engine',
});

const WHISPER_RESOURCES = Object.freeze([
  zipResource({
    id: 'whisper-runtime',
    downloadUrl:
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-12.4.0-bin-x64.zip',
    sha256: '443110ddaad70d4290ab2e77179e31cf712035bbc4fad56bb4519a90c917b39c',
    expectedSize: 670_611_449,
    destinationRelativePath: 'transcription/whisper/engine',
  }),
  fileResource({
    id: 'whisper-model',
    downloadUrl:
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    expectedSize: 574_041_195,
    destinationRelativePath:
      'transcription/whisper/models/ggml-large-v3-turbo-q5_0.bin',
  }),
  fileResource({
    id: 'whisper-silero-vad',
    downloadUrl:
      'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin',
    sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
    expectedSize: 885_098,
    destinationRelativePath:
      'transcription/whisper/models/ggml-silero-v6.2.0.bin',
  }),
]);

const SENSEVOICE_RESOURCES = Object.freeze([
  zipResource({
    id: 'sensevoice-runtime',
    downloadUrl:
      'https://github.com/QwenAudio/SenseVoice/releases/download/runtime-llamacpp-v0.1.9/funasr-llamacpp-windows-x64-avx2.zip',
    sha256: 'f2a1389658e6fb5f5f93c7bad98b5ce100eb4811e0e3c39603e39466773b1b4c',
    expectedSize: 4_917_274,
    destinationRelativePath: 'transcription/sensevoice/engine',
  }),
  fileResource({
    id: 'sensevoice-model',
    downloadUrl:
      'https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/main/sensevoice-small-q8.gguf',
    sha256: '4ae45c94422de949b387e2e0fb10d7e14e4c42c69db30c3444ecc7d4b844b7c5',
    expectedSize: 254_208_320,
    destinationRelativePath:
      'transcription/sensevoice/models/sensevoice-small-q8.gguf',
  }),
  fileResource({
    id: 'sensevoice-fsmn-vad',
    downloadUrl:
      'https://huggingface.co/FunAudioLLM/fsmn-vad-GGUF/resolve/main/fsmn-vad.gguf',
    sha256: '1270f2559c495f4e7b6e739541151027d360761a3fda43fc147034f5719f5479',
    expectedSize: 1_720_512,
    destinationRelativePath: 'transcription/sensevoice/models/fsmn-vad.gguf',
  }),
]);

function windowsMediaSubtitleSuite(
  variantId: string,
): ExternalLibraryBundlePackageDefinition {
  const nvidia = variantId === MEDIA_SUBTITLE_NVIDIA_VARIANT_ID;
  return Object.freeze({
    platform: 'win32',
    architecture: 'x64',
    variantId,
    packageType: 'bundle',
    resources: Object.freeze([
      FFMPEG_RESOURCE,
      ...(nvidia ? WHISPER_RESOURCES : SENSEVOICE_RESOURCES),
    ]),
    requiredRelativePaths: Object.freeze([
      `decoder/engine/ffmpeg-${FFMPEG_VERSION}-essentials_build/bin/ffmpeg.exe`,
      `decoder/engine/ffmpeg-${FFMPEG_VERSION}-essentials_build/bin/ffprobe.exe`,
      ...(nvidia
        ? [
            'transcription/whisper/engine/Release/whisper-cli.exe',
            'transcription/whisper/models/ggml-large-v3-turbo-q5_0.bin',
            'transcription/whisper/models/ggml-silero-v6.2.0.bin',
          ]
        : [
            'transcription/sensevoice/engine/llama-funasr-sensevoice.exe',
            'transcription/sensevoice/engine/llama-funasr-vad.exe',
            'transcription/sensevoice/models/sensevoice-small-q8.gguf',
            'transcription/sensevoice/models/fsmn-vad.gguf',
          ]),
    ]),
  });
}

export function createMediaSubtitleSuiteDefinition(
  defaultVariantId:
    | typeof MEDIA_SUBTITLE_CPU_VARIANT_ID
    | typeof MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
): ExternalLibraryDefinition {
  return Object.freeze({
    id: MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    displayName: '视频/音频字幕组件',
    description:
      '自动匹配当前硬件，一次安装媒体解码与字幕识别能力。字幕翻译使用已配置的工作台 AI。',
    category: 'media',
    version: '2026.08.28',
    installationFormatVersion: 2,
    sourceUrl: 'https://github.com/wu-tian807/learning-companion',
    licenseName: 'GPL-3.0 / MIT / Apache-2.0 / model licenses',
    licenseUrl:
      'https://github.com/wu-tian807/learning-companion/blob/main/docs/superpowers/specs/2026-08-16-media-subtitle-runtime-dependencies.md',
    variants: Object.freeze([
      Object.freeze({
        id: MEDIA_SUBTITLE_CPU_VARIANT_ID,
        displayName: 'CPU 兼容版',
      }),
      Object.freeze({
        id: MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
        displayName: 'NVIDIA GPU 加速版',
      }),
    ]),
    defaultVariantId,
    packages: Object.freeze([
      windowsMediaSubtitleSuite(MEDIA_SUBTITLE_CPU_VARIANT_ID),
      windowsMediaSubtitleSuite(MEDIA_SUBTITLE_NVIDIA_VARIANT_ID),
    ]),
  });
}

export const mediaSubtitleSuiteDefinition = createMediaSubtitleSuiteDefinition(
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
);

export const mediaSubtitleDependencyVersions = Object.freeze({
  ffmpeg: FFMPEG_VERSION,
  whisper: WHISPER_VERSION,
  senseVoice: FUNASR_RUNTIME_VERSION,
});
