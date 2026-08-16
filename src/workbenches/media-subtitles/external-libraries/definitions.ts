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
const LLAMA_VERSION = 'b10442';

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

function gzipResource(input: {
  readonly id: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly destinationRelativePath: string;
  readonly outputSha256: string;
  readonly outputSize: number;
}): ExternalLibraryBundleResourceDefinition {
  return Object.freeze({
    id: input.id,
    downloadUrl: input.downloadUrl,
    sha256: input.sha256,
    expectedSize: input.expectedSize,
    installation: Object.freeze({
      type: 'gzip' as const,
      destinationRelativePath: input.destinationRelativePath,
      outputSha256: input.outputSha256,
      outputSize: input.outputSize,
    }),
  });
}

const FFMPEG_RESOURCE = zipResource({
  id: 'ffmpeg-runtime',
  downloadUrl:
    'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip',
  sha256:
    'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec',
  expectedSize: 109_728_040,
  destinationRelativePath: 'decoder/engine',
});

const WHISPER_VAD_RESOURCE = fileResource({
  id: 'whisper-silero-vad',
  downloadUrl:
    'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin',
  sha256:
    '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
  expectedSize: 885_098,
  destinationRelativePath:
    'transcription/whisper/models/ggml-silero-v6.2.0.bin',
});

const WHISPER_RESOURCES = Object.freeze([
  zipResource({
    id: 'whisper-runtime',
    downloadUrl:
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-12.4.0-bin-x64.zip',
    sha256:
      '443110ddaad70d4290ab2e77179e31cf712035bbc4fad56bb4519a90c917b39c',
    expectedSize: 670_611_449,
    destinationRelativePath: 'transcription/whisper/engine',
  }),
  fileResource({
    id: 'whisper-model',
    downloadUrl:
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    sha256:
      '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    expectedSize: 574_041_195,
    destinationRelativePath:
      'transcription/whisper/models/ggml-large-v3-turbo-q5_0.bin',
  }),
  WHISPER_VAD_RESOURCE,
]);

const SENSEVOICE_RESOURCES = Object.freeze([
  zipResource({
    id: 'sensevoice-runtime',
    downloadUrl:
      'https://github.com/QwenAudio/SenseVoice/releases/download/runtime-llamacpp-v0.1.9/funasr-llamacpp-windows-x64-avx2.zip',
    sha256:
      'f2a1389658e6fb5f5f93c7bad98b5ce100eb4811e0e3c39603e39466773b1b4c',
    expectedSize: 4_917_274,
    destinationRelativePath: 'transcription/sensevoice/engine',
  }),
  fileResource({
    id: 'sensevoice-model',
    downloadUrl:
      'https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/main/sensevoice-small-q8.gguf',
    sha256:
      '4ae45c94422de949b387e2e0fb10d7e14e4c42c69db30c3444ecc7d4b844b7c5',
    expectedSize: 254_208_320,
    destinationRelativePath:
      'transcription/sensevoice/models/sensevoice-small-q8.gguf',
  }),
  fileResource({
    id: 'sensevoice-fsmn-vad',
    downloadUrl:
      'https://huggingface.co/FunAudioLLM/fsmn-vad-GGUF/resolve/main/fsmn-vad.gguf',
    sha256:
      '1270f2559c495f4e7b6e739541151027d360761a3fda43fc147034f5719f5479',
    expectedSize: 1_720_512,
    destinationRelativePath:
      'transcription/sensevoice/models/fsmn-vad.gguf',
  }),
]);

function bergamotResources(): readonly ExternalLibraryBundleResourceDefinition[] {
  const root =
    'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models';

  return Object.freeze([
    gzipResource({
      id: 'bergamot-en-zh-model',
      downloadUrl: `${root}/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/model.enzh.intgemm.alphas.bin.gz`,
      sha256:
        '7f255403b3bb2502f08ac4d5ca397a8a5a13f899d2f2e987a4934e089d241d16',
      expectedSize: 33_375_922,
      destinationRelativePath:
        'translation/bergamot/en-zh/model.bin',
      outputSha256:
        '4e5accc141373565ddc8fa1565bceaa8d0c3482a82cab8131c719ebcc6c2157c',
      outputSize: 43_849_787,
    }),
    gzipResource({
      id: 'bergamot-en-zh-shortlist',
      downloadUrl: `${root}/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/lex.50.50.enzh.s2t.bin.gz`,
      sha256:
        '806f75821c0b838f4a8f4afe5bab3db8289cb7e5187753ba04c3bceadd75687a',
      expectedSize: 2_536_039,
      destinationRelativePath:
        'translation/bergamot/en-zh/shortlist.bin',
      outputSha256:
        '8575d8daa10e2dbff316dcdf8e1ce475357bcc2c92bdc63b736a2d5add22f681',
      outputSize: 4_485_184,
    }),
    gzipResource({
      id: 'bergamot-en-zh-src-vocab',
      downloadUrl: `${root}/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/srcvocab.enzh.spm.gz`,
      sha256:
        '7846e3c236388390f4e5d321f8413d67f34c1bab5f066165eeb673bfd07607cc',
      expectedSize: 407_784,
      destinationRelativePath:
        'translation/bergamot/en-zh/srcVocab.bin',
      outputSha256:
        'bd9b65504acc6d9726dd281f7defc2adb7c2c22d0688fe2f84697de25197c8c5',
      outputSize: 806_952,
    }),
    gzipResource({
      id: 'bergamot-en-zh-trg-vocab',
      downloadUrl: `${root}/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/trgvocab.enzh.spm.gz`,
      sha256:
        '4d641ce165b1f8478ee2ffb5149d2d46fab3779dc8fa1e9b97f9af1d2206c091',
      expectedSize: 425_748,
      destinationRelativePath:
        'translation/bergamot/en-zh/trgVocab.bin',
      outputSha256:
        'aded6993c36e440284d11cec3f6b8aef9c0e43188a772d80be342a713adf223d',
      outputSize: 772_004,
    }),
    gzipResource({
      id: 'bergamot-zh-en-model',
      downloadUrl: `${root}/zh-en/cjk_icu_base_LQeOIbF7Sbq3XA8lsRPotw/exported/model.zhen.intgemm.alphas.bin.gz`,
      sha256:
        '820f50dc36b1e25c97208fff0470bae7fda62bd6f371c4c4bf94947a9de58497',
      expectedSize: 44_369_188,
      destinationRelativePath:
        'translation/bergamot/zh-en/model.bin',
      outputSha256:
        '3535442962ec8f4a553cc19b206befcac689ee9cddaea44fa91e21527fc30ac2',
      outputSize: 59_504_955,
    }),
    gzipResource({
      id: 'bergamot-zh-en-shortlist',
      downloadUrl: `${root}/zh-en/cjk_icu_base_LQeOIbF7Sbq3XA8lsRPotw/exported/lex.50.50.zhen.s2t.bin.gz`,
      sha256:
        'b1bef5f75f5068877afdb2db0eeb670129165976bfa2af4889928f59c264b7b9',
      expectedSize: 4_824_122,
      destinationRelativePath:
        'translation/bergamot/zh-en/shortlist.bin',
      outputSha256:
        'cdcad3592dc2bc4676c34c4d37203f7649ee989195cf083cbb60f1ea011f976b',
      outputSize: 9_220_016,
    }),
    gzipResource({
      id: 'bergamot-zh-en-vocab',
      downloadUrl: `${root}/zh-en/cjk_icu_base_LQeOIbF7Sbq3XA8lsRPotw/exported/vocab.zhen.spm.gz`,
      sha256:
        'fd0cc08ddcbe480e3be06e6a86cb8aaf75f946263a5d9fc7d2773a197990cfb2',
      expectedSize: 738_862,
      destinationRelativePath:
        'translation/bergamot/zh-en/vocab.bin',
      outputSha256:
        'dff594318ab7d8b7b60b844ab98ebe6b932ae8045fab15235404c787715965b3',
      outputSize: 1_359_697,
    }),
  ]);
}

function hyMtResources(
  variantId: string,
): readonly ExternalLibraryBundleResourceDefinition[] {
  const nvidia = variantId === MEDIA_SUBTITLE_NVIDIA_VARIANT_ID;

  return Object.freeze([
    zipResource({
      id: 'hymt-runtime',
      downloadUrl: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}/llama-${LLAMA_VERSION}-bin-win-${nvidia ? 'vulkan' : 'cpu'}-x64.zip`,
      sha256: nvidia
        ? '5cd520d44276a9233c2f87cd2aeabbc26745ef92f92bbf43123feed694aab4b6'
        : '67a5da01b254be88294bdb477f481b71bb482b838e8d7da013eef8b20a0cfa24',
      expectedSize: nvidia ? 34_819_616 : 18_477_132,
      destinationRelativePath: 'translation/hymt/engine',
    }),
    fileResource({
      id: 'hymt-model',
      downloadUrl:
        'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf?download=true',
      sha256:
        'dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699',
      expectedSize: 1_133_080_448,
      destinationRelativePath:
        'translation/hymt/models/Hy-MT2-1.8B-Q4_K_M.gguf',
    }),
  ]);
}

const BERGAMOT_REQUIRED_PATHS = Object.freeze([
  'translation/bergamot/en-zh/model.bin',
  'translation/bergamot/en-zh/shortlist.bin',
  'translation/bergamot/en-zh/srcVocab.bin',
  'translation/bergamot/en-zh/trgVocab.bin',
  'translation/bergamot/zh-en/model.bin',
  'translation/bergamot/zh-en/shortlist.bin',
  'translation/bergamot/zh-en/vocab.bin',
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
      ...bergamotResources(),
      ...hyMtResources(variantId),
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
      ...BERGAMOT_REQUIRED_PATHS,
      'translation/hymt/engine/llama-server.exe',
      'translation/hymt/engine/llama.dll',
      ...(nvidia
        ? ['translation/hymt/engine/ggml-vulkan.dll']
        : ['translation/hymt/engine/ggml-cpu-x64.dll']),
      'translation/hymt/models/Hy-MT2-1.8B-Q4_K_M.gguf',
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
      '自动匹配当前硬件，一次安装媒体解码、字幕识别与中英双向翻译所需的完整本地能力。',
    category: 'media',
    version: '2026.08.16',
    installationFormatVersion: 1,
    sourceUrl: 'https://github.com/wu-tian807/learning-companion',
    licenseName:
      'GPL-3.0 / MIT / MPL-2.0 / Apache-2.0 / model licenses',
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

export const mediaSubtitleSuiteDefinition =
  createMediaSubtitleSuiteDefinition(MEDIA_SUBTITLE_CPU_VARIANT_ID);

export const mediaSubtitleDependencyVersions = Object.freeze({
  ffmpeg: FFMPEG_VERSION,
  whisper: WHISPER_VERSION,
  senseVoice: FUNASR_RUNTIME_VERSION,
  llama: LLAMA_VERSION,
});
