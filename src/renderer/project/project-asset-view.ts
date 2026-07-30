import type { AssetSnapshot } from '../../shared/assets';

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

export function formatAssetLastUsed(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

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
