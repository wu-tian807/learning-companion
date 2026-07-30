import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from 'node:fs/promises';
import {
  isAbsolute,
  dirname,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path';

import {
  isPortableWorkspaceRelativePath,
} from '../../shared/assets';
import { AppError } from '../errors/app-error';
import {
  isPathInside,
  resolvePortableWorkspacePath,
  toPortableRelativePath,
} from '../projects/project-workspace-paths';
import type { AssetArtifact } from './asset-artifact';

export const ASSET_ARTIFACTS_DIRECTORY =
  '.learning-companion/artifacts';
export const ASSET_ARTIFACT_STAGING_DIRECTORY =
  '.learning-companion/.staging/artifacts';

export interface CommittedAssetArtifactFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly artifactRevision: string;
}

export interface AssetArtifactFileManagerApi {
  createStagingDirectory(workspacePath: string): Promise<string>;
  commitFile(input: {
    readonly workspacePath: string;
    readonly stagingDirectory: string;
    readonly producedFilePath: string;
    readonly assetId: string;
    readonly producerId: string;
    readonly extension: string;
  }): Promise<CommittedAssetArtifactFile>;
  resolveValidArtifact(
    workspacePath: string,
    artifact: AssetArtifact,
  ): Promise<string | undefined>;
  removeArtifactFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<void>;
  cleanupStagingDirectory(
    workspacePath: string,
    stagingDirectory: string,
  ): Promise<void>;
}

export interface AssetArtifactFileManagerDependencies {
  readonly createId: () => string;
}

function isFileSystemError(
  error: unknown,
  codes: readonly string[],
): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as NodeJS.ErrnoException).code === 'string' &&
    codes.includes((error as NodeJS.ErrnoException).code!)
  );
}

function requireWorkspacePath(workspacePath: string): string {
  const normalized = normalize(workspacePath.trim());

  if (normalized.length === 0 || !isAbsolute(normalized)) {
    throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE');
  }

  return normalized;
}

function requireSafePathSegment(value: string): string {
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

function requireExtension(value: string): string {
  const normalized = value.trim().replace(/^\./u, '').toLowerCase();

  if (!/^[a-z0-9][a-z0-9+-]{0,15}$/u.test(normalized)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function requireManagedArtifactRelativePath(relativePath: string): string {
  if (
    !isPortableWorkspaceRelativePath(relativePath) ||
    !relativePath.startsWith(`${ASSET_ARTIFACTS_DIRECTORY}/`)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return relativePath;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest('hex');
}

async function ensureManagedDirectory(
  workspacePath: string,
  portableRelativePath: string,
): Promise<string> {
  const workspace = requireWorkspacePath(workspacePath);
  const realWorkspace = await realpath(workspace);
  let current = workspace;

  for (const segment of portableRelativePath.split('/')) {
    current = join(current, segment);

    try {
      await mkdir(current);
    } catch (error) {
      if (!isFileSystemError(error, ['EEXIST'])) {
        throw error;
      }
    }

    const stats = await lstat(current);

    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !isPathInside(realWorkspace, await realpath(current))
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
  }

  return current;
}

async function inspectManagedArtifactFile(
  workspacePath: string,
  relativePath: string,
): Promise<string | undefined> {
  const workspace = requireWorkspacePath(workspacePath);
  const managedRelativePath =
    requireManagedArtifactRelativePath(relativePath);
  const artifactsRoot = resolvePortableWorkspacePath(
    workspace,
    ASSET_ARTIFACTS_DIRECTORY,
  );
  const artifactPath = resolvePortableWorkspacePath(
    workspace,
    managedRelativePath,
  );

  try {
    const [
      artifactsRootStats,
      artifactStats,
      realWorkspace,
      realArtifactsRoot,
      realArtifactParent,
    ] = await Promise.all([
      lstat(artifactsRoot),
      lstat(artifactPath),
      realpath(workspace),
      realpath(artifactsRoot),
      realpath(dirname(artifactPath)),
    ]);

    if (
      !artifactsRootStats.isDirectory() ||
      artifactsRootStats.isSymbolicLink() ||
      !artifactStats.isFile() ||
      artifactStats.isSymbolicLink() ||
      !isPathInside(realWorkspace, realArtifactsRoot) ||
      !isPathInside(realArtifactsRoot, realArtifactParent)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return artifactPath;
  } catch (error) {
    if (isFileSystemError(error, ['ENOENT', 'ENOTDIR'])) {
      return undefined;
    }

    throw error;
  }
}

export class AssetArtifactFileManager
  implements AssetArtifactFileManagerApi
{
  private readonly createId: () => string;

  constructor(
    dependencies: Partial<AssetArtifactFileManagerDependencies> = {},
  ) {
    this.createId = dependencies.createId ?? randomUUID;
  }

  async createStagingDirectory(workspacePath: string): Promise<string> {
    const workspace = requireWorkspacePath(workspacePath);
    const stagingRoot = await ensureManagedDirectory(
      workspace,
      ASSET_ARTIFACT_STAGING_DIRECTORY,
    );
    return mkdtemp(join(stagingRoot, `${this.createId()}-`));
  }

  async commitFile(input: {
    readonly workspacePath: string;
    readonly stagingDirectory: string;
    readonly producedFilePath: string;
    readonly assetId: string;
    readonly producerId: string;
    readonly extension: string;
  }): Promise<CommittedAssetArtifactFile> {
    const workspace = requireWorkspacePath(input.workspacePath);
    const stagingDirectory = resolve(input.stagingDirectory);
    const producedFilePath = resolve(input.producedFilePath);
    const assetId = requireSafePathSegment(input.assetId);
    const producerId = requireSafePathSegment(input.producerId);
    const extension = requireExtension(input.extension);
    const expectedStagingRoot = resolvePortableWorkspacePath(
      workspace,
      ASSET_ARTIFACT_STAGING_DIRECTORY,
    );

    if (
      !isPathInside(expectedStagingRoot, stagingDirectory) ||
      !isPathInside(stagingDirectory, producedFilePath)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const [
      realExpectedStagingRoot,
      realStagingDirectory,
      producedStats,
    ] = await Promise.all([
      realpath(expectedStagingRoot),
      realpath(stagingDirectory),
      lstat(producedFilePath),
    ]);

    if (
      !isPathInside(realExpectedStagingRoot, realStagingDirectory) ||
      !producedStats.isFile() ||
      producedStats.isSymbolicLink() ||
      !isPathInside(realStagingDirectory, await realpath(producedFilePath))
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const artifactRevision = await hashFile(producedFilePath);
    const targetDirectory = await ensureManagedDirectory(
      workspace,
      `${ASSET_ARTIFACTS_DIRECTORY}/${assetId}/${producerId}`,
    );
    const targetPath = join(
      targetDirectory,
      `${artifactRevision}.${extension}`,
    );
    try {
      await link(producedFilePath, targetPath);
    } catch (error) {
      if (
        !isFileSystemError(error, ['EEXIST']) ||
        (await hashFile(targetPath)) !== artifactRevision
      ) {
        throw error;
      }
    }

    await rm(producedFilePath, { force: true });
    const portableRelativePath = toPortableRelativePath(
      relative(workspace, targetPath),
    );

    return Object.freeze({
      absolutePath: targetPath,
      relativePath:
        requireManagedArtifactRelativePath(portableRelativePath),
      artifactRevision,
    });
  }

  async resolveValidArtifact(
    workspacePath: string,
    artifact: AssetArtifact,
  ): Promise<string | undefined> {
    const artifactPath = await inspectManagedArtifactFile(
      workspacePath,
      artifact.relativePath,
    );

    if (!artifactPath) {
      return undefined;
    }

    try {
      return (await hashFile(artifactPath)) === artifact.artifactRevision
        ? artifactPath
        : undefined;
    } catch (error) {
      if (isFileSystemError(error, ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'])) {
        return undefined;
      }

      throw error;
    }
  }

  async removeArtifactFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<void> {
    const artifactPath = await inspectManagedArtifactFile(
      workspacePath,
      relativePath,
    );

    if (!artifactPath) {
      return;
    }

    await rm(artifactPath, { force: true });
  }

  async cleanupStagingDirectory(
    workspacePath: string,
    stagingDirectory: string,
  ): Promise<void> {
    const workspace = requireWorkspacePath(workspacePath);
    const expectedStagingRoot = resolvePortableWorkspacePath(
      workspace,
      ASSET_ARTIFACT_STAGING_DIRECTORY,
    );
    const resolvedStagingDirectory = resolve(stagingDirectory);

    if (
      !isAbsolute(stagingDirectory) ||
      !isPathInside(expectedStagingRoot, resolvedStagingDirectory) ||
      resolvedStagingDirectory === expectedStagingRoot
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    try {
      const [rootStats, stagingStats] = await Promise.all([
        lstat(expectedStagingRoot),
        lstat(resolvedStagingDirectory),
      ]);

      if (
        !rootStats.isDirectory() ||
        rootStats.isSymbolicLink() ||
        !stagingStats.isDirectory() ||
        stagingStats.isSymbolicLink() ||
        !isPathInside(
          await realpath(expectedStagingRoot),
          await realpath(resolvedStagingDirectory),
        )
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
    } catch (error) {
      if (isFileSystemError(error, ['ENOENT', 'ENOTDIR'])) {
        return;
      }

      throw error;
    }

    await rm(resolvedStagingDirectory, { recursive: true, force: true });
  }
}
