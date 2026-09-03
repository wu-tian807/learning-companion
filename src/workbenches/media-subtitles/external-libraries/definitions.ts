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
const SHERPA_ONNX_VERSION = '1.13.2';

function resource(input: {
  readonly id: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly destinationRelativePath: string;
  readonly type?: 'file' | 'zip' | 'tar-bzip2';
}): ExternalLibraryBundleResourceDefinition {
  return Object.freeze({
    id: input.id,
    downloadUrl: input.downloadUrl,
    sha256: input.sha256,
    expectedSize: input.expectedSize,
    installation: Object.freeze({
      type: input.type ?? 'file',
      destinationRelativePath: input.destinationRelativePath,
    }),
  });
}

const FFMPEG_RESOURCE = resource({
  id: 'ffmpeg-runtime',
  downloadUrl:
    'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip',
  sha256: 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec',
  expectedSize: 109_728_040,
  destinationRelativePath: 'decoder/engine',
  type: 'zip',
});

const WHISPER_RESOURCES = Object.freeze([
  resource({
    id: 'whisper-runtime',
    downloadUrl:
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-12.4.0-bin-x64.zip',
    sha256: '443110ddaad70d4290ab2e77179e31cf712035bbc4fad56bb4519a90c917b39c',
    expectedSize: 670_611_449,
    destinationRelativePath: 'transcription/whisper/engine',
    type: 'zip',
  }),
  resource({
    id: 'whisper-model',
    downloadUrl:
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    expectedSize: 574_041_195,
    destinationRelativePath:
      'transcription/whisper/models/ggml-large-v3-turbo-q5_0.bin',
  }),
  resource({
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
  resource({
    id: 'sensevoice-runtime',
    downloadUrl:
      'https://github.com/QwenAudio/SenseVoice/releases/download/runtime-llamacpp-v0.1.9/funasr-llamacpp-windows-x64-avx2.zip',
    sha256: 'f2a1389658e6fb5f5f93c7bad98b5ce100eb4811e0e3c39603e39466773b1b4c',
    expectedSize: 4_917_274,
    destinationRelativePath: 'transcription/sensevoice/engine',
    type: 'zip',
  }),
  resource({
    id: 'sensevoice-model',
    downloadUrl:
      'https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/main/sensevoice-small-q8.gguf',
    sha256: '4ae45c94422de949b387e2e0fb10d7e14e4c42c69db30c3444ecc7d4b844b7c5',
    expectedSize: 254_208_320,
    destinationRelativePath:
      'transcription/sensevoice/models/sensevoice-small-q8.gguf',
  }),
  resource({
    id: 'sensevoice-fsmn-vad',
    downloadUrl:
      'https://huggingface.co/FunAudioLLM/fsmn-vad-GGUF/resolve/main/fsmn-vad.gguf',
    sha256: '1270f2559c495f4e7b6e739541151027d360761a3fda43fc147034f5719f5479',
    expectedSize: 1_720_512,
    destinationRelativePath: 'transcription/sensevoice/models/fsmn-vad.gguf',
  }),
]);

const SPEAKER_RESOURCES = Object.freeze([
  resource({
    id: 'speaker-runtime',
    downloadUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.2/sherpa-onnx-v1.13.2-win-x64-shared-MD-Release-no-tts.tar.bz2',
    sha256: 'd74ad2c3e2f943e51ed8b15d409281dea378fcb21f7bb83e8b070be03f2f6715',
    expectedSize: 17_837_065,
    destinationRelativePath: 'speaker/engine',
    type: 'tar-bzip2',
  }),
  resource({
    id: 'speaker-segmentation-model',
    downloadUrl:
      'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/340b52f1f5cd12d45a30fa284691417eaad2ff92/model.int8.onnx?download=true',
    sha256: '10a438c2e0d90ed5f5da545cec2244d887315f6dbbbf1d3d564d00745b01952e',
    expectedSize: 1_540_514,
    destinationRelativePath:
      'speaker/models/pyannote-segmentation-3.0.int8.onnx',
  }),
  resource({
    id: 'speaker-embedding-model',
    downloadUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
    sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
    expectedSize: 28_281_164,
    destinationRelativePath: 'speaker/models/3dspeaker-campplus-zh-en.onnx',
  }),
]);

function windowsPackage(
  variantId:
    | typeof MEDIA_SUBTITLE_CPU_VARIANT_ID
    | typeof MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
): ExternalLibraryBundlePackageDefinition {
  const nvidia = variantId === MEDIA_SUBTITLE_NVIDIA_VARIANT_ID;
  return Object.freeze({
    platform: 'win32',
    architecture: 'x64',
    variantId,
    packageType: 'bundle',
    estimatedInstalledSize: (nvidia ? 2_500 : 800) * 1024 * 1024,
    recommendedFreeSpace: (nvidia ? 3_500 : 1_500) * 1024 * 1024,
    resources: Object.freeze([
      FFMPEG_RESOURCE,
      ...(nvidia ? WHISPER_RESOURCES : SENSEVOICE_RESOURCES),
      ...SPEAKER_RESOURCES,
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
      `speaker/engine/sherpa-onnx-v${SHERPA_ONNX_VERSION}-win-x64-shared-MD-Release-no-tts/bin/sherpa-onnx-offline-speaker-diarization.exe`,
      'speaker/models/pyannote-segmentation-3.0.int8.onnx',
      'speaker/models/3dspeaker-campplus-zh-en.onnx',
    ]),
  });
}

export type MediaSubtitleVariantId =
  | typeof MEDIA_SUBTITLE_CPU_VARIANT_ID
  | typeof MEDIA_SUBTITLE_NVIDIA_VARIANT_ID;

export function createMediaSubtitleSuiteDefinition(
  defaultVariantId: MediaSubtitleVariantId,
): ExternalLibraryDefinition {
  return Object.freeze({
    id: MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    displayName: '视频/音频字幕组件',
    description:
      '生成视频与音频字幕；音频会识别说话人，视频仅在配音时按需分析音色参考。字幕翻译使用已配置的工作台 AI。',
    category: 'media',
    // Keep the persisted path so the obsolete MOSS bundle is detected as an
    // invalid format and can be removed instead of becoming a disk orphan.
    version: '2026.08.28',
    installationFormatVersion: 4,
    sourceUrl: 'https://github.com/wu-tian807/learning-companion',
    licenseName: 'GPL-3.0 / MIT / Apache-2.0 / model licenses',
    licenseUrl:
      'https://github.com/wu-tian807/learning-companion/blob/main/docs/superpowers/specs/2026-08-16-media-subtitle-runtime-dependencies.md',
    variants: Object.freeze([
      Object.freeze({
        id: MEDIA_SUBTITLE_CPU_VARIANT_ID,
        displayName: 'Windows CPU 兼容版',
      }),
      Object.freeze({
        id: MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
        displayName: 'Windows NVIDIA 加速版',
      }),
    ]),
    defaultVariantId,
    packages: Object.freeze([
      windowsPackage(MEDIA_SUBTITLE_CPU_VARIANT_ID),
      windowsPackage(MEDIA_SUBTITLE_NVIDIA_VARIANT_ID),
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
  sherpaOnnx: SHERPA_ONNX_VERSION,
});
