import { randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  utimes,
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
  ExternalLibraryDownloadResourceDefinition,
  ExternalLibraryPackageDefinition,
} from './external-library-definition';
import { externalLibraryPackageFingerprint } from './external-library-definition';
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
export const EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY = '.downloads';
const EXTERNAL_LIBRARY_RUNTIME_SETUP_CACHE_DIRECTORY = '.setup';
export const EXTERNAL_LIBRARY_STAGING_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const EXTERNAL_LIBRARY_DOWNLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export interface ExternalLibraryDownloadPaths {
  readonly rootPath: string;
  readonly downloadDirectory: string;
  readonly partialPath: string;
  readonly packagePath: string;
  readonly destinationPath: string;
}

export interface ExternalLibraryTemporaryDataCleanupResult {
  readonly stagingDirectoriesRemoved: number;
  readonly downloadDirectoriesRemoved: number;
}

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
  prepareDownloadPaths(input: {
    readonly rootPath: string;
    readonly definition: ExternalLibraryDefinition;
    readonly packageDefinition: ExternalLibraryPackageDefinition;
    readonly resourceDefinition: ExternalLibraryDownloadResourceDefinition;
  }): Promise<ExternalLibraryDownloadPaths>;
  completeDownload(paths: ExternalLibraryDownloadPaths): Promise<string>;
  prepareRuntimeSetupCacheDirectory(
    rootPath: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): Promise<string>;
  cleanupPackageDownloads(
    rootPath: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): Promise<void>;
  cleanupLibraryDownloads(
    rootPath: string,
    definition: ExternalLibraryDefinition,
  ): Promise<void>;
  cleanupExpiredTemporaryData(
    rootPath: string,
    currentTime: number,
  ): Promise<ExternalLibraryTemporaryDataCleanupResult>;
  cleanupTemporaryData(rootPath: string): Promise<void>;
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

async function existingRegularFile(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);

    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return true;
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) {
      return false;
    }

    throw error;
  }
}

async function inspectManagedRoot(
  rootPath: string,
  managedDirectoryName: string,
): Promise<
  | {
      readonly path: string;
      readonly realPath: string;
    }
  | undefined
> {
  const root = requireExternalLibraryRootPath(rootPath);
  const managedPath = join(root, managedDirectoryName);

  try {
    const [rootStats, managedStats] = await Promise.all([
      lstat(root),
      lstat(managedPath),
    ]);

    if (
      !rootStats.isDirectory() ||
      rootStats.isSymbolicLink() ||
      !managedStats.isDirectory() ||
      managedStats.isSymbolicLink()
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const [realRoot, realManagedPath] = await Promise.all([
      realpath(root),
      realpath(managedPath),
    ]);

    if (!isPathInside(realRoot, realManagedPath)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return { path: managedPath, realPath: realManagedPath };
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) {
      return undefined;
    }

    throw error;
  }
}

async function requireManagedTreeLatestModification(
  path: string,
  realManagedRoot: string,
): Promise<number> {
  const stats = await lstat(path);

  if (stats.isSymbolicLink()) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  if (!stats.isDirectory() && !stats.isFile()) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  if (!isPathInside(realManagedRoot, await realpath(path))) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  let latest = stats.mtimeMs;

  if (stats.isDirectory()) {
    for (const entry of await readdir(path)) {
      latest = Math.max(
        latest,
        await requireManagedTreeLatestModification(
          join(path, entry),
          realManagedRoot,
        ),
      );
    }
  }

  return latest;
}

async function cleanupManagedSubdirectory(
  rootPath: string,
  managedDirectoryName: string,
  targetPath: string,
): Promise<void> {
  const managedRoot = await inspectManagedRoot(
    rootPath,
    managedDirectoryName,
  );

  if (!managedRoot) {
    return;
  }

  const target = resolve(targetPath);

  if (
    target === managedRoot.path ||
    !isPathInside(managedRoot.path, target)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  try {
    const targetStats = await lstat(target);

    if (
      !targetStats.isDirectory() ||
      targetStats.isSymbolicLink() ||
      !isPathInside(managedRoot.realPath, await realpath(target))
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

async function cleanupManagedChildren(
  rootPath: string,
  managedDirectoryName: string,
): Promise<void> {
  const managedRoot = await inspectManagedRoot(
    rootPath,
    managedDirectoryName,
  );

  if (!managedRoot) {
    return;
  }

  for (const entry of await readdir(managedRoot.path)) {
    const target = join(managedRoot.path, entry);
    await requireManagedTreeLatestModification(
      target,
      managedRoot.realPath,
    );
    await rm(target, { recursive: true, force: true });
  }
}

function resourceFileName(
  packageDefinition: ExternalLibraryPackageDefinition,
  resourceId: string,
): string {
  const id = requireSafeDirectorySegment(resourceId);

  return packageDefinition.packageType === 'bundle'
    ? `resource.${id}`
    : `package.${packageDefinition.packageType}`;
}

function resolveDownloadDirectory(
  rootPath: string,
  definition: ExternalLibraryDefinition,
  packageDefinition: ExternalLibraryPackageDefinition,
): string {
  const root = requireExternalLibraryRootPath(rootPath);
  const libraryId = requireSafeDirectorySegment(definition.id);
  const fingerprint = requireSafeDirectorySegment(
    externalLibraryPackageFingerprint(packageDefinition),
  );

  return join(
    root,
    EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
    libraryId,
    fingerprint,
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
    const shortJobId = requireManagedDirectorySegment(
      this.createId(),
    ).slice(0, 8);
    await ensureDirectory(root);
    const stagingRoot = await ensureManagedDirectory(root, [
      EXTERNAL_LIBRARY_STAGING_DIRECTORY,
    ]);

    return mkdtemp(
      join(
        stagingRoot,
        `${normalizedLibraryId.slice(0, 8)}-${shortJobId}-`,
      ),
    );
  }

  async prepareDownloadPaths(input: {
    readonly rootPath: string;
    readonly definition: ExternalLibraryDefinition;
    readonly packageDefinition: ExternalLibraryPackageDefinition;
    readonly resourceDefinition: ExternalLibraryDownloadResourceDefinition;
  }): Promise<ExternalLibraryDownloadPaths> {
    const root = requireExternalLibraryRootPath(input.rootPath);
    const libraryId = requireSafeDirectorySegment(input.definition.id);
    const fingerprint = requireSafeDirectorySegment(
      externalLibraryPackageFingerprint(input.packageDefinition),
    );
    const fileName = resourceFileName(
      input.packageDefinition,
      input.resourceDefinition.id,
    );
    await ensureDirectory(root);
    const downloadDirectory = await ensureManagedDirectory(root, [
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
      libraryId,
      fingerprint,
    ]);
    const partialPath = join(downloadDirectory, `${fileName}.partial`);
    const packagePath = join(downloadDirectory, fileName);
    const hasPackage = await existingRegularFile(packagePath);
    await existingRegularFile(partialPath);
    const accessTime = new Date();
    await utimes(downloadDirectory, accessTime, accessTime);

    return Object.freeze({
      rootPath: root,
      downloadDirectory,
      partialPath,
      packagePath,
      destinationPath: hasPackage ? packagePath : partialPath,
    });
  }

  async completeDownload(
    paths: ExternalLibraryDownloadPaths,
  ): Promise<string> {
    const root = requireExternalLibraryRootPath(paths.rootPath);
    const downloadRoot = join(root, EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY);
    const downloadDirectory = resolve(paths.downloadDirectory);
    const partialPath = resolve(paths.partialPath);
    const packagePath = resolve(paths.packagePath);
    const destinationPath = resolve(paths.destinationPath);

    if (
      !isPathInside(downloadRoot, downloadDirectory) ||
      !isPathInside(downloadDirectory, partialPath) ||
      !isPathInside(downloadDirectory, packagePath) ||
      (destinationPath !== partialPath && destinationPath !== packagePath)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const managedRoot = await inspectManagedRoot(
      root,
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
    );
    const downloadDirectoryStats = await lstat(downloadDirectory);

    if (
      !managedRoot ||
      !downloadDirectoryStats.isDirectory() ||
      downloadDirectoryStats.isSymbolicLink() ||
      !isPathInside(
        managedRoot.realPath,
        await realpath(downloadDirectory),
      )
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    if (destinationPath === packagePath) {
      if (!(await existingRegularFile(packagePath))) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      if (await existingRegularFile(partialPath)) {
        await rm(partialPath, { force: true });
      }
      return packagePath;
    }

    if (!(await existingRegularFile(partialPath))) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    await rename(partialPath, packagePath);
    return packagePath;
  }

  async prepareRuntimeSetupCacheDirectory(
    rootPath: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): Promise<string> {
    const root = requireExternalLibraryRootPath(rootPath);
    const libraryId = requireSafeDirectorySegment(definition.id);
    await ensureDirectory(root);
    const setupRoot = await ensureManagedDirectory(root, [
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
      EXTERNAL_LIBRARY_RUNTIME_SETUP_CACHE_DIRECTORY,
    ]);
    const cacheDirectory = join(setupRoot, libraryId);

    try {
      await lstat(cacheDirectory);
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) throw error;

      const legacyDirectory = join(
        resolveDownloadDirectory(root, definition, packageDefinition),
        'runtime-setup',
      );
      try {
        const [legacyStats, downloadRoot] = await Promise.all([
          lstat(legacyDirectory),
          inspectManagedRoot(root, EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY),
        ]);
        if (
          !downloadRoot ||
          !legacyStats.isDirectory() ||
          legacyStats.isSymbolicLink() ||
          !isPathInside(
            downloadRoot.realPath,
            await realpath(legacyDirectory),
          )
        ) {
          throw new AppError('DATA_INTEGRITY_ERROR');
        }
        await rename(legacyDirectory, cacheDirectory);
      } catch (legacyError) {
        if (!isFileSystemError(legacyError, 'ENOENT')) throw legacyError;
      }
    }

    const managedCacheDirectory = await ensureManagedDirectory(root, [
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
      EXTERNAL_LIBRARY_RUNTIME_SETUP_CACHE_DIRECTORY,
      libraryId,
    ]);
    const accessTime = new Date();
    await utimes(managedCacheDirectory, accessTime, accessTime);
    return managedCacheDirectory;
  }

  async cleanupPackageDownloads(
    rootPath: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): Promise<void> {
    await cleanupManagedSubdirectory(
      rootPath,
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
      resolveDownloadDirectory(rootPath, definition, packageDefinition),
    );
    await cleanupManagedSubdirectory(
      rootPath,
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
      join(
        requireExternalLibraryRootPath(rootPath),
        EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
        EXTERNAL_LIBRARY_RUNTIME_SETUP_CACHE_DIRECTORY,
        requireSafeDirectorySegment(definition.id),
      ),
    );
  }

  async cleanupLibraryDownloads(
    rootPath: string,
    definition: ExternalLibraryDefinition,
  ): Promise<void> {
    const root = requireExternalLibraryRootPath(rootPath);
    await cleanupManagedSubdirectory(
      root,
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
      join(
        root,
        EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
        requireSafeDirectorySegment(definition.id),
      ),
    );
    await cleanupManagedSubdirectory(
      root,
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
      join(
        root,
        EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
        EXTERNAL_LIBRARY_RUNTIME_SETUP_CACHE_DIRECTORY,
        requireSafeDirectorySegment(definition.id),
      ),
    );
  }

  async cleanupExpiredTemporaryData(
    rootPath: string,
    currentTime: number,
  ): Promise<ExternalLibraryTemporaryDataCleanupResult> {
    if (!Number.isFinite(currentTime) || currentTime < 0) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    let stagingDirectoriesRemoved = 0;
    let downloadDirectoriesRemoved = 0;
    const stagingRoot = await inspectManagedRoot(
      rootPath,
      EXTERNAL_LIBRARY_STAGING_DIRECTORY,
    );

    if (stagingRoot) {
      for (const entry of await readdir(stagingRoot.path)) {
        const target = join(stagingRoot.path, entry);
        const targetStats = await lstat(target);

        if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
          throw new AppError('DATA_INTEGRITY_ERROR');
        }
        const latest = await requireManagedTreeLatestModification(
          target,
          stagingRoot.realPath,
        );

        if (latest <= currentTime - EXTERNAL_LIBRARY_STAGING_RETENTION_MS) {
          await rm(target, { recursive: true, force: true });
          stagingDirectoriesRemoved += 1;
        }
      }
    }

    const downloadRoot = await inspectManagedRoot(
      rootPath,
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
    );

    if (downloadRoot) {
      for (const libraryEntry of await readdir(downloadRoot.path)) {
        const libraryPath = join(downloadRoot.path, libraryEntry);
        const libraryStats = await lstat(libraryPath);

        if (!libraryStats.isDirectory() || libraryStats.isSymbolicLink()) {
          throw new AppError('DATA_INTEGRITY_ERROR');
        }
        if (
          !isPathInside(
            downloadRoot.realPath,
            await realpath(libraryPath),
          )
        ) {
          throw new AppError('DATA_INTEGRITY_ERROR');
        }

        for (const packageEntry of await readdir(libraryPath)) {
          const packagePath = join(libraryPath, packageEntry);
          const packageStats = await lstat(packagePath);

          if (!packageStats.isDirectory() || packageStats.isSymbolicLink()) {
            throw new AppError('DATA_INTEGRITY_ERROR');
          }
          const latest = await requireManagedTreeLatestModification(
            packagePath,
            downloadRoot.realPath,
          );

          if (latest <= currentTime - EXTERNAL_LIBRARY_DOWNLOAD_RETENTION_MS) {
            await rm(packagePath, { recursive: true, force: true });
            downloadDirectoriesRemoved += 1;
          }
        }

        await rmdir(libraryPath).catch((error: unknown) => {
          if (
            !isFileSystemError(error, 'ENOENT') &&
            !isFileSystemError(error, 'ENOTEMPTY')
          ) {
            throw error;
          }
        });
      }
    }

    return Object.freeze({
      stagingDirectoriesRemoved,
      downloadDirectoriesRemoved,
    });
  }

  async cleanupTemporaryData(rootPath: string): Promise<void> {
    await cleanupManagedChildren(
      rootPath,
      EXTERNAL_LIBRARY_STAGING_DIRECTORY,
    );
    await cleanupManagedChildren(
      rootPath,
      EXTERNAL_LIBRARY_DOWNLOAD_DIRECTORY,
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
    await cleanupManagedSubdirectory(
      rootPath,
      EXTERNAL_LIBRARY_STAGING_DIRECTORY,
      stagingDirectory,
    );
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
      maxRetries: 8,
      retryDelay: 100,
    });
  }
}
