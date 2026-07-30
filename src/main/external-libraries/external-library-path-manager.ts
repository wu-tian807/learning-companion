import { isAbsolute, join, normalize } from 'node:path';

import { AppError } from '../errors/app-error';

function requireAbsoluteDirectoryPath(path: string): string {
  const normalized = normalize(path.trim());

  if (normalized.length === 0 || !isAbsolute(normalized)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

export function createDefaultExternalLibrariesRoot(
  documentsDirectory: string,
): string {
  return join(
    requireAbsoluteDirectoryPath(documentsDirectory),
    'Learning Companion',
    'externalLib',
  );
}
