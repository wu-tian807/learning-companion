import type {
  ExternalLibraryBundlePackageDefinition,
  ExternalLibraryBundleResourceDefinition,
  ExternalLibraryDefinition,
} from '../../../main/external-libraries/external-library-definition';

export const MEDIA_SUBTITLE_SUITE_LIBRARY_ID = 'media-subtitles';
export const MEDIA_SUBTITLE_CPU_VARIANT_ID = 'cpu';
export const MEDIA_SUBTITLE_NVIDIA_VARIANT_ID = 'nvidia';
export const MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID = 'apple-silicon';

const FFMPEG_VERSION = '8.1.2';
const FUNASR_RUNTIME_VERSION = '0.1.9';
const MOSS_RUNTIME_VERSION = '0.2.3';
const MOSS_MODEL_REVISION =
  '6fdfa33aed776bbb0ac11a1a9835634fe6d75dd7';
const SHERPA_ONNX_VERSION = '1.13.2';

function resource(input: {
  readonly id: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly installation: ExternalLibraryBundleResourceDefinition['installation'];
}): ExternalLibraryBundleResourceDefinition {
  return Object.freeze({
    ...input,
    installation: Object.freeze(input.installation),
  });
}

function fileResource(input: {
  readonly id: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly destinationRelativePath: string;
}): ExternalLibraryBundleResourceDefinition {
  return resource({
    ...input,
    installation: {
      type: 'file',
      destinationRelativePath: input.destinationRelativePath,
    },
  });
}

function archiveResource(input: {
  readonly id: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly destinationRelativePath: string;
  readonly type: 'zip' | 'tar-gzip' | 'tar-bzip2';
}): ExternalLibraryBundleResourceDefinition {
  return resource({
    ...input,
    installation: {
      type: input.type,
      destinationRelativePath: input.destinationRelativePath,
    },
  });
}

const WINDOWS_FFMPEG_RESOURCE = archiveResource({
  id: 'ffmpeg-runtime',
  downloadUrl:
    'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip',
  sha256: 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec',
  expectedSize: 109_728_040,
  destinationRelativePath: 'decoder/engine',
  type: 'zip',
});

const MACOS_FFMPEG_RESOURCE = archiveResource({
  id: 'ffmpeg-runtime',
  downloadUrl:
    'https://github.com/binmgr/ffmpeg/releases/download/v8.1.2/ffmpeg-darwin-arm64.tar.gz',
  sha256: '4bc5a828d01aeaab25bbbc8749018ed2f3731e044f64fe86fb9a3a2a426a3eb5',
  expectedSize: 20_808_220,
  destinationRelativePath: 'decoder/engine',
  type: 'tar-gzip',
});

const SENSEVOICE_RESOURCES = Object.freeze([
  archiveResource({
    id: 'sensevoice-runtime',
    downloadUrl:
      'https://github.com/QwenAudio/SenseVoice/releases/download/runtime-llamacpp-v0.1.9/funasr-llamacpp-windows-x64-avx2.zip',
    sha256: 'f2a1389658e6fb5f5f93c7bad98b5ce100eb4811e0e3c39603e39466773b1b4c',
    expectedSize: 4_917_274,
    destinationRelativePath: 'transcription/sensevoice/engine',
    type: 'zip',
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

const SPEAKER_MODELS = Object.freeze([
  fileResource({
    id: 'speaker-segmentation-model',
    downloadUrl:
      'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/340b52f1f5cd12d45a30fa284691417eaad2ff92/model.int8.onnx?download=true',
    sha256: '10a438c2e0d90ed5f5da545cec2244d887315f6dbbbf1d3d564d00745b01952e',
    expectedSize: 1_540_514,
    destinationRelativePath:
      'speaker/models/pyannote-segmentation-3.0.int8.onnx',
  }),
  fileResource({
    id: 'speaker-embedding-model',
    downloadUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
    sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
    expectedSize: 28_281_164,
    destinationRelativePath: 'speaker/models/3dspeaker-campplus-zh-en.onnx',
  }),
]);

const SHERPA_WINDOWS_RESOURCE = archiveResource({
  id: 'speaker-runtime',
  downloadUrl:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.2/sherpa-onnx-v1.13.2-win-x64-shared-MD-Release-no-tts.tar.bz2',
  sha256: 'd74ad2c3e2f943e51ed8b15d409281dea378fcb21f7bb83e8b070be03f2f6715',
  expectedSize: 17_837_065,
  destinationRelativePath: 'speaker/engine',
  type: 'tar-bzip2',
});

const MOSS_MODEL_RESOURCE = fileResource({
  id: 'moss-model-q5',
  downloadUrl:
    `https://huggingface.co/handy-computer/moss-transcribe-diarize-gguf/resolve/${MOSS_MODEL_REVISION}/MOSS-Transcribe-Diarize-Q5_K_M.gguf?download=true`,
  sha256: '52deaeff931272f3d49eb437f0f4916e42fce9f42e68db250047408241cf473c',
  expectedSize: 700_313_760,
  destinationRelativePath:
    'transcription/moss/models/MOSS-Transcribe-Diarize-Q5_K_M.gguf',
});

const MOSS_PYTHON_BINDING_RESOURCE = archiveResource({
  id: 'moss-python-binding',
  downloadUrl:
    'https://files.pythonhosted.org/packages/c6/39/832282b7d27e29ee48f2c89c243b431078dfc235ca48b59b35c74431ce55/transcribe_cpp-0.2.3-py3-none-any.whl',
  sha256: 'be4ec773c3e48993301f5b4256781ee5ef96ff075e904fc495c0effd096f1a03',
  expectedSize: 34_910,
  destinationRelativePath: 'transcription/moss/python-packages',
  type: 'zip',
});

const MOSS_WINDOWS_CUDA_RESOURCES = Object.freeze([
  archiveResource({
    id: 'moss-cuda-cublas-runtime',
    downloadUrl:
      'https://files.pythonhosted.org/packages/20/e2/fc9a0e985249d873150276d5afb02e39a66817fedbf1a385724393e505ed/nvidia_cublas_cu12-12.9.2.10-py3-none-win_amd64.whl',
    sha256:
      '623f43027d40d44ceadf0043f002bd25cf353e8f13ce90b9a87057019f560661',
    expectedSize: 553_162_896,
    destinationRelativePath: 'transcription/moss/cuda-cublas',
    type: 'zip',
  }),
  archiveResource({
    id: 'moss-cuda-core-runtime',
    downloadUrl:
      'https://files.pythonhosted.org/packages/59/df/e7c3a360be4f7b93cee39271b792669baeb3846c58a4df6dfcf187a7ffab/nvidia_cuda_runtime_cu12-12.9.79-py3-none-win_amd64.whl',
    sha256:
      '8e018af8fa02363876860388bd10ccb89eb9ab8fb0aa749aaf58430a9f7c4891',
    expectedSize: 3_591_604,
    destinationRelativePath: 'transcription/moss/cuda-core',
    type: 'zip',
  }),
]);

const MOSS_WINDOWS_RESOURCES = Object.freeze([
  archiveResource({
    id: 'moss-python-runtime',
    downloadUrl:
      'https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-x86_64-pc-windows-msvc-install_only.tar.gz',
    sha256: '15d25c455ea25d6b24d7e58eabdf744fd0db3cfb977934ae08fd2237acd8ccc1',
    expectedSize: 46_154_932,
    destinationRelativePath: 'transcription/moss/python-runtime',
    type: 'tar-gzip',
  }),
  archiveResource({
    id: 'moss-native-runtime',
    downloadUrl:
      'https://github.com/handy-computer/transcribe.cpp/releases/download/v0.2.3/transcribe-native-0.2.3-windows-x86_64-cuda.tar.gz',
    sha256: 'c2010ff89300b1b5568872b1e728e62af69f8b59ceae7dc04b4fd0151f582428',
    expectedSize: 199_669_683,
    destinationRelativePath: 'transcription/moss/engine',
    type: 'tar-gzip',
  }),
  ...MOSS_WINDOWS_CUDA_RESOURCES,
  MOSS_PYTHON_BINDING_RESOURCE,
  MOSS_MODEL_RESOURCE,
]);

const MOSS_MACOS_RESOURCES = Object.freeze([
  archiveResource({
    id: 'moss-python-runtime',
    downloadUrl:
      'https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-aarch64-apple-darwin-install_only.tar.gz',
    sha256: '62eef3fcf48fa4f792d0d6d267c140b81aaea0edca4ae0641d8021854314f966',
    expectedSize: 25_128_196,
    destinationRelativePath: 'transcription/moss/python-runtime',
    type: 'tar-gzip',
  }),
  archiveResource({
    id: 'moss-native-runtime',
    downloadUrl:
      'https://github.com/handy-computer/transcribe.cpp/releases/download/v0.2.3/transcribe-native-0.2.3-macos-arm64-metal.tar.gz',
    sha256: '1cc5e89d442f55c165a3f90e49090cec75cec349071d834c0aa656161afa9543',
    expectedSize: 1_509_309,
    destinationRelativePath: 'transcription/moss/engine',
    type: 'tar-gzip',
  }),
  MOSS_PYTHON_BINDING_RESOURCE,
  MOSS_MODEL_RESOURCE,
]);

function windowsCpuPackage(): ExternalLibraryBundlePackageDefinition {
  return Object.freeze({
    platform: 'win32',
    architecture: 'x64',
    variantId: MEDIA_SUBTITLE_CPU_VARIANT_ID,
    packageType: 'bundle',
    estimatedInstalledSize: 800 * 1024 * 1024,
    recommendedFreeSpace: 1_500 * 1024 * 1024,
    resources: Object.freeze([
      WINDOWS_FFMPEG_RESOURCE,
      ...SENSEVOICE_RESOURCES,
      SHERPA_WINDOWS_RESOURCE,
      ...SPEAKER_MODELS,
    ]),
    requiredRelativePaths: Object.freeze([
      `decoder/engine/ffmpeg-${FFMPEG_VERSION}-essentials_build/bin/ffmpeg.exe`,
      `decoder/engine/ffmpeg-${FFMPEG_VERSION}-essentials_build/bin/ffprobe.exe`,
      'transcription/sensevoice/engine/llama-funasr-sensevoice.exe',
      'transcription/sensevoice/engine/llama-funasr-vad.exe',
      'transcription/sensevoice/models/sensevoice-small-q8.gguf',
      'transcription/sensevoice/models/fsmn-vad.gguf',
      `speaker/engine/sherpa-onnx-v${SHERPA_ONNX_VERSION}-win-x64-shared-MD-Release-no-tts/bin/sherpa-onnx-offline-speaker-diarization.exe`,
      'speaker/models/pyannote-segmentation-3.0.int8.onnx',
      'speaker/models/3dspeaker-campplus-zh-en.onnx',
    ]),
  });
}

function windowsNvidiaPackage(): ExternalLibraryBundlePackageDefinition {
  return Object.freeze({
    platform: 'win32',
    architecture: 'x64',
    variantId: MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
    packageType: 'bundle',
    estimatedInstalledSize: 2_500 * 1024 * 1024,
    recommendedFreeSpace: 3_500 * 1024 * 1024,
    resources: Object.freeze([
      WINDOWS_FFMPEG_RESOURCE,
      ...MOSS_WINDOWS_RESOURCES,
    ]),
    requiredRelativePaths: Object.freeze([
      `decoder/engine/ffmpeg-${FFMPEG_VERSION}-essentials_build/bin/ffmpeg.exe`,
      `decoder/engine/ffmpeg-${FFMPEG_VERSION}-essentials_build/bin/ffprobe.exe`,
      'transcription/moss/python-runtime/python/python.exe',
      'transcription/moss/python-packages/transcribe_cpp/__init__.py',
      'transcription/moss/engine/transcribe-native-windows-x86_64-cuda/transcribe.dll',
      'transcription/moss/cuda-cublas/nvidia/cublas/bin/cublas64_12.dll',
      'transcription/moss/cuda-cublas/nvidia/cublas/bin/cublasLt64_12.dll',
      'transcription/moss/cuda-core/nvidia/cuda_runtime/bin/cudart64_12.dll',
      'transcription/moss/models/MOSS-Transcribe-Diarize-Q5_K_M.gguf',
    ]),
  });
}

function macosAppleSiliconPackage(): ExternalLibraryBundlePackageDefinition {
  return Object.freeze({
    platform: 'darwin',
    architecture: 'arm64',
    variantId: MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID,
    packageType: 'bundle',
    estimatedInstalledSize: 1_300 * 1024 * 1024,
    recommendedFreeSpace: 2_000 * 1024 * 1024,
    resources: Object.freeze([
      MACOS_FFMPEG_RESOURCE,
      ...MOSS_MACOS_RESOURCES,
    ]),
    requiredRelativePaths: Object.freeze([
      'decoder/engine/ffmpeg',
      'decoder/engine/ffprobe',
      'transcription/moss/python-runtime/python/bin/python3.12',
      'transcription/moss/python-packages/transcribe_cpp/__init__.py',
      'transcription/moss/engine/transcribe-native-macos-arm64-metal/libtranscribe.dylib',
      'transcription/moss/models/MOSS-Transcribe-Diarize-Q5_K_M.gguf',
    ]),
  });
}

export type MediaSubtitleVariantId =
  | typeof MEDIA_SUBTITLE_CPU_VARIANT_ID
  | typeof MEDIA_SUBTITLE_NVIDIA_VARIANT_ID
  | typeof MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID;

export function createMediaSubtitleSuiteDefinition(
  defaultVariantId: MediaSubtitleVariantId,
): ExternalLibraryDefinition {
  return Object.freeze({
    id: MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    displayName: '视频/音频字幕组件',
    description:
      '生成视频与音频字幕，并在字幕阶段识别说话人；支持的加速设备还可保留重叠说话内容。字幕翻译使用已配置的工作台 AI。',
    category: 'media',
    // Keep the persisted directory identity so the previous GPU bundle is
    // detected as an invalid format and can be removed instead of orphaned.
    version: '2026.08.28',
    installationFormatVersion: 3,
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
      Object.freeze({
        id: MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID,
        displayName: 'macOS Apple Silicon 版',
      }),
    ]),
    defaultVariantId,
    packages: Object.freeze([
      windowsCpuPackage(),
      windowsNvidiaPackage(),
      macosAppleSiliconPackage(),
    ]),
  });
}

export const mediaSubtitleSuiteDefinition = createMediaSubtitleSuiteDefinition(
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
);

export const mediaSubtitleDependencyVersions = Object.freeze({
  ffmpeg: FFMPEG_VERSION,
  moss: MOSS_RUNTIME_VERSION,
  senseVoice: FUNASR_RUNTIME_VERSION,
  sherpaOnnx: SHERPA_ONNX_VERSION,
});
