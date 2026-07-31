import type {
  AssetCreationKind,
  AssetSnapshot,
} from '../../shared/assets';

export type AssetLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly assets: AssetSnapshot[] }
  | { readonly kind: 'failed' };

export const assetAvailabilityLabels = {
  available: '可用',
  missing: '文件缺失',
  inaccessible: '无访问权限',
  invalid: '路径无效',
} as const;

export function assetMediaLabel(mediaType: string): string {
  const labels: Record<string, string> = {
    'application/epub+zip': 'EPUB',
    'application/octet-stream': '未知',
    'application/pdf': 'PDF',
    'application/msword': 'Word',
    'application/vnd.ms-powerpoint': 'PowerPoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'PowerPoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'Word',
    'audio/aac': 'AAC',
    'audio/flac': 'FLAC',
    'audio/mp4': 'M4A',
    'audio/mpeg': 'MP3',
    'audio/ogg': 'Ogg / Opus',
    'audio/wav': 'WAV',
    'audio/webm': 'WebM Audio',
    'image/bmp': 'BMP',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/webp': 'WebP',
    'text/html': 'HTML',
    'text/markdown': 'Markdown',
    'text/plain': '纯文本',
    'video/mp4': 'MP4',
    'video/ogg': 'Ogg 视频',
    'video/quicktime': 'QuickTime',
    'video/webm': 'WebM',
  };

  return labels[mediaType] ?? mediaType;
}

export function filterAssetsByCreationKind(
  assets: readonly AssetSnapshot[],
  creationKind: AssetCreationKind,
): AssetSnapshot[] {
  return assets.filter(
    (asset) => asset.creationKind === creationKind,
  );
}

export function sortAssetsByLastUsed(
  assets: readonly AssetSnapshot[],
): AssetSnapshot[] {
  return [...assets].sort(
    (left, right) => right.lastUsedTime - left.lastUsedTime,
  );
}

export function filterAssetLoadStateByCreationKind(
  state: AssetLoadState,
  creationKind: AssetCreationKind,
): AssetLoadState {
  return state.kind === 'ready'
    ? {
        kind: 'ready',
        assets: filterAssetsByCreationKind(
          state.assets,
          creationKind,
        ),
      }
    : state;
}
