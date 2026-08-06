import { basename, extname } from 'node:path';

import { AppError } from '../errors/app-error';
import {
  currentPlatformPathRules,
  isPathInside,
  type FileSystemPathRules,
} from '../filesystem/file-system-path-rules';

export { isPathInside, type FileSystemPathRules };

export const PROJECT_WORKSPACE_METADATA_DIRECTORY = '.learning-companion';

export function requireAbsoluteWorkspaceDirectoryPath(
  path: string,
  pathRules: FileSystemPathRules = currentPlatformPathRules,
): string {
  const normalizedPath = pathRules.normalize(path.trim());

  if (
    normalizedPath.length === 0 ||
    !pathRules.isAbsolute(normalizedPath) ||
    normalizedPath === pathRules.parse(normalizedPath).root
  ) {
    throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE');
  }

  return normalizedPath;
}

export function requireAbsoluteWorkspaceFilePath(
  path: string,
  pathRules: FileSystemPathRules = currentPlatformPathRules,
): string {
  const normalizedPath = pathRules.normalize(path.trim());

  if (
    normalizedPath.length === 0 ||
    !pathRules.isAbsolute(normalizedPath)
  ) {
    throw new AppError('ASSET_UNAVAILABLE');
  }

  return normalizedPath;
}

export function toPortableRelativePath(path: string): string {
  return path.split('\\').join('/');
}

export function resolvePortableWorkspacePath(
  workspacePath: string,
  portableRelativePath: string,
  pathRules: FileSystemPathRules = currentPlatformPathRules,
): string {
  const candidate = pathRules.resolve(
    workspacePath,
    portableRelativePath.split('/').join(pathRules.sep),
  );

  if (!isPathInside(workspacePath, candidate, pathRules)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return candidate;
}

export function sanitizeProjectDirectoryName(name: string): string {
  const withoutControlCharacters = [...name.trim()]
    .map((character) =>
      character.codePointAt(0)! < 0x20 ? '-' : character,
    )
    .join('');
  const sanitized = withoutControlCharacters
    .trim()
    .replace(/[<>:"/\\|?*]/gu, '-')
    .replace(/[.\s]+$/u, '')
    .slice(0, 80);

  return sanitized.length > 0 ? sanitized : '未命名 Project';
}

export function createConflictFreeFileName(
  originalName: string,
  suffix: number,
): string {
  if (suffix === 1) {
    return originalName;
  }

  const extension = extname(originalName);
  const stem = basename(originalName, extension);
  return `${stem} (${suffix})${extension}`;
}

export function createDefaultProjectWorkspaceRoot(
  documentsDirectory: string,
  pathRules: FileSystemPathRules = currentPlatformPathRules,
): string {
  return pathRules.join(
    requireAbsoluteWorkspaceDirectoryPath(
      documentsDirectory,
      pathRules,
    ),
    'Learning Companion',
    'Projects',
  );
}
