import { AppError } from '../errors/app-error';
import {
  currentPlatformPathRules,
  type FileSystemPathRules,
} from '../filesystem/file-system-path-rules';
import type {
  ExternalLibraryDefinition,
  ExternalLibraryPackageDefinition,
} from './external-library-definition';

export interface ExternalLibraryInstallationPaths {
  readonly rootPath: string;
  readonly installationDirectory: string;
  readonly runtimeDirectory: string;
}

export function requireExternalLibraryRootPath(
  rootPath: string,
  pathRules: FileSystemPathRules = currentPlatformPathRules,
): string {
  const normalized = pathRules.normalize(rootPath.trim());

  if (
    normalized.length === 0 ||
    !pathRules.isAbsolute(normalized) ||
    normalized === pathRules.parse(normalized).root
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

export function requireSafeDirectorySegment(value: string): string {
  const normalized = value.trim();

  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized) ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

export function resolveExternalLibraryInstallationPaths(
  rootPath: string,
  definition: ExternalLibraryDefinition,
  packageDefinition: ExternalLibraryPackageDefinition,
  pathRules: FileSystemPathRules = currentPlatformPathRules,
): ExternalLibraryInstallationPaths {
  const root = requireExternalLibraryRootPath(rootPath, pathRules);
  const libraryId = requireSafeDirectorySegment(definition.id);
  const version = requireSafeDirectorySegment(definition.version);
  const platform = requireSafeDirectorySegment(
    packageDefinition.platform,
  );
  const architecture = requireSafeDirectorySegment(
    packageDefinition.architecture,
  );
  const installationDirectory = pathRules.join(
    root,
    libraryId,
    version,
    `${platform}-${architecture}`,
  );

  return Object.freeze({
    rootPath: root,
    installationDirectory,
    runtimeDirectory: pathRules.join(
      installationDirectory,
      'runtime',
    ),
  });
}

export function createDefaultExternalLibrariesRoot(
  documentsDirectory: string,
  pathRules: FileSystemPathRules = currentPlatformPathRules,
): string {
  return pathRules.join(
    requireExternalLibraryRootPath(documentsDirectory, pathRules),
    'Learning Companion',
    'externalLib',
  );
}
