import type {
  ExternalLibraryBundleResourceDefinition,
  ExternalLibraryDefinition,
} from '../../../main/external-libraries/external-library-definition';

// Persisted library identity: keep the historical value so existing
// installations remain valid when Audio starts sharing this runtime.
export const MEDIA_DUBBING_VOXCPM2_LIBRARY_ID = 'video-dubbing-voxcpm2';
export const MEDIA_DUBBING_VOXCPM2_VERSION = '2026.08.29';
export const VOXCPM2_MODEL_REVISION =
  '32279effe8c19989596f05d353d1447f51d9e915';

function fileResource(input: {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}): ExternalLibraryBundleResourceDefinition {
  return Object.freeze({
    id: input.id,
    downloadUrl: `https://huggingface.co/openbmb/VoxCPM2/resolve/${VOXCPM2_MODEL_REVISION}/${input.path}?download=true`,
    sha256: input.sha256,
    expectedSize: input.size,
    installation: Object.freeze({
      type: 'file' as const,
      destinationRelativePath: `models/VoxCPM2/${input.path}`,
    }),
  });
}

const MODEL_RESOURCES = Object.freeze([
  fileResource({
    id: 'voxcpm2-audio-vae',
    path: 'audiovae.pth',
    sha256: '94b5d51e107e0507d4acc976cfdadb64edd6fd06d1f751dadbf2fd1594274bf1',
    size: 376_951_122,
  }),
  fileResource({
    id: 'voxcpm2-config',
    path: 'config.json',
    sha256: '405f0dcd92f7feba6011ed4eac5c8d4f74cba9712f07fd5cfa3063bbdd95402c',
    size: 4_336,
  }),
  fileResource({
    id: 'voxcpm2-weights',
    path: 'model.safetensors',
    sha256: 'f7f964cfa9da23653baec6e6f7750719977ad944ed9f95fe52fe3a620506891d',
    size: 4_580_080_592,
  }),
  fileResource({
    id: 'voxcpm2-special-tokens',
    path: 'special_tokens_map.json',
    sha256: '068594063e37662c02b21acf42ebb334ef6a74fb810e68a2368f88f08351de76',
    size: 1_632,
  }),
  fileResource({
    id: 'voxcpm2-tokenization',
    path: 'tokenization_voxcpm2.py',
    sha256: '84489ea32b6ee0cae22ed5480cacb6df85c46624c3119be9a2021c3649a12729',
    size: 2_895,
  }),
  fileResource({
    id: 'voxcpm2-tokenizer-config',
    path: 'tokenizer_config.json',
    sha256: 'e78a3ebb48a0b9437efd1823b6b726c823da89e49dd8bcc90c02419d9baa772b',
    size: 5_059,
  }),
  fileResource({
    id: 'voxcpm2-tokenizer',
    path: 'tokenizer.json',
    sha256: 'f8984687e4a92a3503d521396d454b7d68e9fdaab2a0288eb3536c7c1aa4bc20',
    size: 3_676_772,
  }),
]);

export const mediaDubbingVoxCpm2Definition: ExternalLibraryDefinition =
  Object.freeze({
    id: MEDIA_DUBBING_VOXCPM2_LIBRARY_ID,
    displayName: 'VoxCPM2 视频/音频配音组件',
    description:
      'NVIDIA GPU 专用。固定模型下载约 4.8 GB；完整 Python/CUDA 配音环境最终约 12 GB，安装时建议至少预留 18 GB 可用空间。',
    category: 'media',
    version: MEDIA_DUBBING_VOXCPM2_VERSION,
    installationFormatVersion: 1,
    sourceUrl: 'https://github.com/OpenBMB/VoxCPM',
    licenseName: 'Apache-2.0 / model licenses',
    licenseUrl: 'https://github.com/OpenBMB/VoxCPM/blob/main/LICENSE',
    packages: Object.freeze([
      Object.freeze({
        platform: 'win32' as const,
        architecture: 'x64' as const,
        packageType: 'bundle' as const,
        resources: Object.freeze([
          Object.freeze({
            id: 'uv-runtime',
            downloadUrl:
              'https://github.com/astral-sh/uv/releases/download/0.12.7/uv-x86_64-pc-windows-msvc.zip',
            sha256:
              'bf1518af459a3915511a11fdc6e2f43ef9a2afa138b9d498eeb9642fe9d85218',
            expectedSize: 16_979_508,
            installation: Object.freeze({
              type: 'zip' as const,
              destinationRelativePath: 'bootstrap/uv',
            }),
          }),
          ...MODEL_RESOURCES,
          Object.freeze({
            id: 'uvr-source-separation-model',
            downloadUrl:
              'https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/UVR-MDX-NET-Inst_HQ_4.onnx',
            sha256:
              'af6de857b80f3ea7c4fd7b0380e7138f5ecf91da3e5f140c463b5aa6d927636f',
            expectedSize: 59_074_650,
            installation: Object.freeze({
              type: 'file' as const,
              destinationRelativePath:
                'models/source-separation/UVR-MDX-NET-Inst_HQ_4.onnx',
            }),
          }),
          Object.freeze({
            id: 'speaker-segmentation-model',
            downloadUrl:
              'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/340b52f1f5cd12d45a30fa284691417eaad2ff92/model.int8.onnx?download=true',
            sha256:
              '10a438c2e0d90ed5f5da545cec2244d887315f6dbbbf1d3d564d00745b01952e',
            expectedSize: 1_540_514,
            installation: Object.freeze({
              type: 'file' as const,
              destinationRelativePath:
                'models/speaker-diarization/pyannote-segmentation-3.0.int8.onnx',
            }),
          }),
          Object.freeze({
            id: 'speaker-embedding-model',
            downloadUrl:
              'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
            sha256:
              'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
            expectedSize: 28_281_164,
            installation: Object.freeze({
              type: 'file' as const,
              destinationRelativePath:
                'models/speaker-diarization/3dspeaker-campplus-zh-en.onnx',
            }),
          }),
        ]),
        requiredRelativePaths: Object.freeze([
          'bootstrap/uv/uv.exe',
          ...MODEL_RESOURCES.map(
            ({ installation }) => installation.destinationRelativePath,
          ),
          'models/source-separation/UVR-MDX-NET-Inst_HQ_4.onnx',
          'models/speaker-diarization/pyannote-segmentation-3.0.int8.onnx',
          'models/speaker-diarization/3dspeaker-campplus-zh-en.onnx',
        ]),
      }),
    ]),
  });
