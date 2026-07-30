import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import {
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

import { AppError } from '../errors/app-error';
import type {
  ExternalLibraryDefinition,
  ExternalLibraryPackageDefinition,
} from './external-library-definition';

export const EXTERNAL_LIBRARY_STAGING_DIRECTORY = '.staging';

export interface ExternalLibraryInstallationPaths {
  readonly rootPath: string;
  readonly installationDirectory: string;
  readonly runtimeDirectory: string;
}

export interface ExternalLibraryPathManagerApi {
  resolveInstallationPaths(
    rootPath: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): ExternalLibraryInstallationPaths;
  createStagingDirectory(
    rootPath: string,
    libraryId: string,
  ): Promise<string>;
  commitInstallation(input: {
    readonly rootPath: string;
    readonly definition: ExternalLibraryDefinition;
    readonly packageDefinition: ExternalLibraryPackageDefinition;
    readonly stagingDirectory: string;
    readonly stagingInstallationDirectory: string;
  }): Promise<ExternalLibraryInstallationPaths>;
  cleanupStagingDirectory(
    rootPath: string,
    stagingDirectory: string,
  ): Promise<void>;
  removeInstallation(
    rootPath: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): Promise<void>;
}

export interface ExternalLibraryPathManagerDependencies {
  readonly createId: () => string;
}

function requireAbsoluteDirectoryPath(path: string): string {
  const normalized = normalize(path.trim());

  if (
    normalized.length === 0 ||
    !isAbsolute(normalized) ||
    normalized === parse(normalized).root
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function requireSafeDirectorySegment(value: string): string {
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

function requireManagedDirectorySegment(value: string): string {
  const normalized = value.trim();

  if (
    !/^[A-Za-z0-9.][A-Za-z0-9._-]{0,127}$/u.test(normalized) ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function isPathInside(root: string, target: string): boolean {
  const relativePath = relative(root, target);

  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== '..' &&
      !isAbsolute(relativePath))
  );
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const stats = await lstat(path);

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
}

async function ensureManagedDirectory(
  rootPath: string,
  segments: readonly string[],
): Promise<string> {
  const root = requireAbsoluteDirectoryPath(rootPath);
  const realRoot = await realpath(root);
  let current = root;

  for (const rawSegment of segments) {
    const segment = requireManagedDirectorySegment(rawSegment);
    current = join(current, segment);

    try {
      await mkdir(current);
    } catch (error) {
      if (!isFileSystemError(error, 'EEXIST')) {
        throw error;
      }
    }

    const stats = await lstat(current);

    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !isPathInside(realRoot, await realpath(current))
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
  }

  return current;
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

export class ExternalLibraryPathManager
  implements ExternalLibraryPathManagerApi
{
  private readonly createId: () => string;

  constructor(
    dependencies: Partial<ExternalLibraryPathManagerDependencies> = {},
  ) {
    this.createId = dependencies.createId ?? randomUUID;
  }

  resolveInstallationPaths(
    rootPath: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): ExternalLibraryInstallationPaths {
    const root = requireAbsoluteDirectoryPath(rootPath);
    const libraryId = requireSafeDirectorySegment(definition.id);
    const version = requireSafeDirectorySegment(definition.version);
    const platform = requireSafeDirectorySegment(
      packageDefinition.platform,
    );
    const architecture = requireSafeDirectorySegment(
      packageDefinition.architecture,
    );
    const installationDirectory = join(
      root,
      libraryId,
      version,
      `${platform}-${architecture}`,
    );

    return Object.freeze({
      rootPath: root,
      installationDirectory,
      runtimeDirectory: join(installationDirectory, 'runtime'),
    });
  }

  async createStagingDirectory(
    rootPath: string,
    libraryId: string,
  ): Promise<string> {
    const root = requireAbsoluteDirectoryPath(rootPath);
    const normalizedLibraryId = requireSafeDirectorySegment(libraryId);
    await ensureDirectory(root);
    const stagingRoot = await ensureManagedDirectory(root, [
      EXTERNAL_LIBRARY_STAGING_DIRECTORY,
    ]);

    return mkdtemp(
      join(stagingRoot, `${normalizedLibraryId}-${this.createId()}-`),
    );
  }

  async commitInstallation(input: {
    readonly rootPath: string;
    readonly definition: ExternalLibraryDefinition;
    readonly packageDefinition: ExternalLibraryPackageDefinition;
    readonly stagingDirectory: string;
    readonly stagingInstallationDirectory: string;
  }): Promise<ExternalLibraryInstallationPaths> {
    const paths = this.resolveInstallationPaths(
      input.rootPath,
      input.definition,
      input.packageDefinition,
    );
    const root = paths.rootPath;
    const stagingRoot = join(root, EXTERNAL_LIBRARY_STAGING_DIRECTORY);
    const stagingDirectory = resolve(input.stagingDirectory);
    const stagingInstallationDirectory = resolve(
      input.stagingInstallationDirectory,
    );

    if (
      !isPathInside(stagingRoot, stagingDirectory) ||
      !isPathInside(
        stagingDirectory,
        stagingInstallationDirectory,
      ) ||
      stagingDirectory === stagingRoot
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const [
      stagingStats,
      installationStats,
      realStagingRoot,
      realStagingDirectory,
      realStagingInstallation,
    ] = await Promise.all([
      lstat(stagingDirectory),
      lstat(stagingInstallationDirectory),
      realpath(stagingRoot),
      realpath(stagingDirectory),
      realpath(stagingInstallationDirectory),
    ]);

    if (
      !stagingStats.isDirectory() ||
      stagingStats.isSymbolicLink() ||
      !installationStats.isDirectory() ||
      installationStats.isSymbolicLink() ||
      !isPathInside(realStagingRoot, realStagingDirectory) ||
      !isPathInside(realStagingDirectory, realStagingInstallation)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    try {
      await lstat(paths.installationDirectory);
      throw new AppError('EXTERNAL_LIBRARY_CONFLICT');
    } catch (error) {
      if (
        error instanceof AppError ||
        !isFileSystemError(error, 'ENOENT')
      ) {
        throw error;
      }
    }

    await ensureManagedDirectory(root, [
      input.definition.id,
      input.definition.version,
    ]);

    try {
      await rename(
        stagingInstallationDirectory,
        paths.installationDirectory,
      );
    } catch (error) {
      if (
        await lstat(paths.installationDirectory)
          .then(() => true)
          .catch(() => false)
      ) {
        throw new AppError('EXTERNAL_LIBRARY_CONFLICT', {
          cause: error,
        });
      }

      throw error;
    }

    return paths;
  }

  async cleanupStagingDirectory(
    rootPath: string,
    stagingDirectory: string,
  ): Promise<void> {
    const root = requireAbsoluteDirectoryPath(rootPath);
    const stagingRoot = join(root, EXTERNAL_LIBRARY_STAGING_DIRECTORY);
    const target = resolve(stagingDirectory);

    if (
      target === stagingRoot ||
      !isPathInside(stagingRoot, target)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    try {
      const [rootStats, targetStats] = await Promise.all([
        lstat(stagingRoot),
        lstat(target),
      ]);

      if (
        !rootStats.isDirectory() ||
        rootStats.isSymbolicLink() ||
        !targetStats.isDirectory() ||
        targetStats.isSymbolicLink() ||
        !isPathInside(
          await realpath(stagingRoot),
          await realpath(target),
        )
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        return;
      }

      throw error;
    }

    await rm(target, { recursive: true, force: true });
  }

  async removeInstallation(
    rootPath: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): Promise<void> {
    const paths = this.resolveInstallationPaths(
      rootPath,
      definition,
      packageDefinition,
    );

    try {
      const [rootStats, installationStats] = await Promise.all([
        lstat(paths.rootPath),
        lstat(paths.installationDirectory),
      ]);

      if (
        !rootStats.isDirectory() ||
        rootStats.isSymbolicLink() ||
        !installationStats.isDirectory() ||
        installationStats.isSymbolicLink() ||
        !isPathInside(
          await realpath(paths.rootPath),
          await realpath(paths.installationDirectory),
        )
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        return;
      }

      throw error;
    }

    await rm(paths.installationDirectory, {
      recursive: true,
      force: true,
    });
  }
}
