import { basename, extname } from 'node:path';

export const UNKNOWN_ASSET_MEDIA_TYPE = 'application/octet-stream';

const mediaTypeByExtension = new Map<string, string>([
  ['.epub', 'application/epub+zip'],
  ['.markdown', 'text/markdown'],
  ['.md', 'text/markdown'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
]);

function requireFileName(path: string): string {
  const fileName = basename(path);

  if (fileName.length === 0 || fileName === '.' || fileName === '..') {
    throw new Error('Asset 本地文件名无效');
  }

  return fileName;
}

export function detectAssetMediaType(path: string): string {
  const extension = extname(requireFileName(path)).toLowerCase();
  return mediaTypeByExtension.get(extension) ?? UNKNOWN_ASSET_MEDIA_TYPE;
}

export function isAssetRelinkMediaCompatible(
  currentMediaType: string,
  currentPath: string,
  newPath: string,
): boolean {
  if (currentMediaType !== UNKNOWN_ASSET_MEDIA_TYPE) {
    return detectAssetMediaType(newPath) === currentMediaType;
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
