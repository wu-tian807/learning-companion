import { randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import {
  dirname,
  join,
  resolve,
} from 'node:path';

import { AppError } from '../errors/app-error';
import { isPathInside } from '../filesystem/file-system-path-rules';
import type {
  ExternalLibraryDefinition,
  ExternalLibraryPackageDefinition,
} from './external-library-definition';
import {
  requireExternalLibraryRootPath,
  requireSafeDirectorySegment,
  resolveExternalLibraryInstallationPaths,
  type ExternalLibraryInstallationPaths,
} from './external-library-paths';

export {
  createDefaultExternalLibrariesRoot,
  type ExternalLibraryInstallationPaths,
} from './external-library-paths';

export const EXTERNAL_LIBRARY_STAGING_DIRECTORY = '.staging';

export interface ExternalLibraryPathManagerApi {
  normalizeRootPath(rootPath: string): string;
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
    readonly replaceExisting?: boolean;
  }): Promise<ExternalLibraryInstallationPaths>;
  stageInstallationMigration(input: {
    readonly targetRootPath: string;
    readonly libraryId: string;
    readonly sourceInstallationDirectory: string;
  }): Promise<ExternalLibraryMigrationStaging>;
  rollbackInstallationCommit(input: {
    readonly rootPath: string;
    readonly definition: ExternalLibraryDefinition;
    readonly packageDefinition: ExternalLibraryPackageDefinition;
    readonly stagingDirectory: string;
  }): Promise<void>;
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

export interface ExternalLibraryMigrationStaging {
  readonly stagingDirectory: string;
  readonly stagingInstallationDirectory: string;
}

export interface ExternalLibraryPathManagerDependencies {
  readonly createId: () => string;
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
  const root = requireExternalLibraryRootPath(rootPath);
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

export class ExternalLibraryPathManager
  implements ExternalLibraryPathManagerApi
{
  private readonly createId: () => string;

  constructor(
    dependencies: Partial<ExternalLibraryPathManagerDependencies> = {},
  ) {
    this.createId = dependencies.createId ?? randomUUID;
  }

  normalizeRootPath(rootPath: string): string {
    return requireExternalLibraryRootPath(rootPath);
  }

  resolveInstallationPaths(
    rootPath: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): ExternalLibraryInstallationPaths {
    return resolveExternalLibraryInstallationPaths(
      rootPath,
      definition,
      packageDefinition,
    );
  }

  async createStagingDirectory(
    rootPath: string,
    libraryId: string,
  ): Promise<string> {
    const root = requireExternalLibraryRootPath(rootPath);
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
    readonly replaceExisting?: boolean;
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

    await ensureManagedDirectory(root, [
      input.definition.id,
      input.definition.version,
    ]);
    const replacedInstallationDirectory = join(
      stagingDirectory,
      '.replaced-installation',
    );
    let replacedExisting = false;

    try {
      const installationStats = await lstat(
        paths.installationDirectory,
      );

      if (!input.replaceExisting) {
        throw new AppError('EXTERNAL_LIBRARY_CONFLICT');
      }
      if (installationStats.isSymbolicLink()) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const realRoot = await realpath(root);
      const realInstallationParent = await realpath(
        dirname(paths.installationDirectory),
      );

      if (!isPathInside(realRoot, realInstallationParent)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      await rename(
        paths.installationDirectory,
        replacedInstallationDirectory,
      );
      replacedExisting = true;
    } catch (error) {
      if (
        error instanceof AppError ||
        !isFileSystemError(error, 'ENOENT')
      ) {
        throw error;
      }
    }

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
        await rm(paths.installationDirectory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
      if (replacedExisting) {
        await rename(
          replacedInstallationDirectory,
          paths.installationDirectory,
        ).catch(() => undefined);
      }

      throw new AppError('EXTERNAL_LIBRARY_CONFLICT', {
        cause: error,
      });
    }

    return paths;
  }

  async stageInstallationMigration(input: {
    readonly targetRootPath: string;
    readonly libraryId: string;
    readonly sourceInstallationDirectory: string;
  }): Promise<ExternalLibraryMigrationStaging> {
    const sourceInstallationDirectory =
      requireExternalLibraryRootPath(
        input.sourceInstallationDirectory,
      );
    const sourceStats = await lstat(sourceInstallationDirectory);

    if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
      throw new AppError('EXTERNAL_LIBRARY_MIGRATION_FAILED');
    }

    const stagingDirectory = await this.createStagingDirectory(
      input.targetRootPath,
      input.libraryId,
    );
    const stagingInstallationDirectory = join(
      stagingDirectory,
      'installation',
    );

    try {
      await cp(
        sourceInstallationDirectory,
        stagingInstallationDirectory,
        {
          recursive: true,
          force: false,
          errorOnExist: true,
          preserveTimestamps: true,
          dereference: false,
          verbatimSymlinks: true,
        },
      );
    } catch (error) {
      await this.cleanupStagingDirectory(
        input.targetRootPath,
        stagingDirectory,
      ).catch(() => undefined);
      throw new AppError('EXTERNAL_LIBRARY_MIGRATION_FAILED', {
        cause: error,
      });
    }

    return Object.freeze({
      stagingDirectory,
      stagingInstallationDirectory,
    });
  }

  async rollbackInstallationCommit(input: {
    readonly rootPath: string;
    readonly definition: ExternalLibraryDefinition;
    readonly packageDefinition: ExternalLibraryPackageDefinition;
    readonly stagingDirectory: string;
  }): Promise<void> {
    const paths = this.resolveInstallationPaths(
      input.rootPath,
      input.definition,
      input.packageDefinition,
    );
    const stagingDirectory = resolve(input.stagingDirectory);
    const stagingRoot = join(
      paths.rootPath,
      EXTERNAL_LIBRARY_STAGING_DIRECTORY,
    );

    if (
      stagingDirectory === stagingRoot ||
      !isPathInside(stagingRoot, stagingDirectory)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const replacedInstallationDirectory = join(
      stagingDirectory,
      '.replaced-installation',
    );
    await rm(paths.installationDirectory, {
      recursive: true,
      force: true,
    });

    try {
      await rename(
        replacedInstallationDirectory,
        paths.installationDirectory,
      );
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) {
        throw error;
      }
    }
  }

  async cleanupStagingDirectory(
    rootPath: string,
    stagingDirectory: string,
  ): Promise<void> {
    const root = requireExternalLibraryRootPath(rootPath);
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
