import { basename, extname } from 'node:path';

import { detectFileTextEncoding } from './asset-text-encoding';

export const UNKNOWN_ASSET_MEDIA_TYPE = 'application/octet-stream';
export const PLAIN_TEXT_ASSET_MEDIA_TYPE = 'text/plain';

const mediaTypeByExtension = new Map<string, string>([
  ['.aac', 'audio/aac'],
  ['.bmp', 'image/bmp'],
  ['.epub', 'application/epub+zip'],
  ['.flac', 'audio/flac'],
  ['.htm', 'text/html'],
  ['.html', 'text/html'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.m4a', 'audio/mp4'],
  ['.m4v', 'video/mp4'],
  ['.markdown', 'text/markdown'],
  ['.md', 'text/markdown'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.oga', 'audio/ogg'],
  ['.ogg', 'audio/ogg'],
  ['.ogv', 'video/ogg'],
  ['.opus', 'audio/ogg'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.wav', 'audio/wav'],
  ['.wave', 'audio/wav'],
  ['.weba', 'audio/webm'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
]);

function requireFileName(path: string): string {
  const fileName = basename(path);

  if (fileName.length === 0 || fileName === '.' || fileName === '..') {
    throw new Error('Asset 本地文件名无效');
  }

  return fileName;
}

export async function detectAssetMediaType(path: string): Promise<string> {
  const extension = extname(requireFileName(path)).toLowerCase();
  const mappedMediaType = mediaTypeByExtension.get(extension);

  if (mappedMediaType) {
    return mappedMediaType;
  }

  return (await detectFileTextEncoding(path))
    ? PLAIN_TEXT_ASSET_MEDIA_TYPE
    : UNKNOWN_ASSET_MEDIA_TYPE;
}

export async function isAssetRelinkMediaCompatible(
  currentMediaType: string,
  currentPath: string,
  newPath: string,
): Promise<boolean> {
  if (currentMediaType !== UNKNOWN_ASSET_MEDIA_TYPE) {
    return (await detectAssetMediaType(newPath)) === currentMediaType;
  }

  return extname(currentPath).toLowerCase() === extname(newPath).toLowerCase();
}

export function createDefaultAssetName(path: string): string {
  const fileName = requireFileName(path);
  const extension = extname(fileName);
  const name =
    extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;

  return name.length > 0 ? name : fileName;
}
