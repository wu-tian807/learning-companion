import { lstat, mkdir, rename, rmdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  isAssetContentRef,
  type ProjectWorkspaceLocalFileContentRef,
} from '../../shared/assets';
import type { DatabaseContext } from '../database/database-context';
import { AppError } from '../errors/app-error';
import {
  PROJECT_WORKSPACE_METADATA_DIRECTORY,
  resolvePortableWorkspacePath,
} from './project-workspace-paths';

const LEGACY_ASSET_PREFIXES = [
  'assets/imported/',
  'assets/generated/',
] as const;
const LEGACY_ATTACHMENT_PREFIX = 'attachments/';

interface StoredContentRefRow {
  readonly id: string;
  readonly workspacePath: string;
  readonly contentRef: string;
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function lstatIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

async function removeDirectoryIfEmpty(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (
      isFileSystemError(error, 'ENOENT') ||
      isFileSystemError(error, 'ENOTEMPTY') ||
      isFileSystemError(error, 'EEXIST')
    ) {
      return;
    }
    throw error;
  }
}

function parseLegacyRef(
  serialized: string,
  prefixes: readonly string[],
): ProjectWorkspaceLocalFileContentRef {
  const value: unknown = JSON.parse(serialized);

  if (
    !isAssetContentRef(value) ||
    value.base !== 'project-workspace' ||
    !prefixes.some((prefix) => value.path.startsWith(prefix))
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return value;
}

async function moveManagedFile(
  workspacePath: string,
  legacyPath: string,
  managedPath: string,
): Promise<void> {
  const sourcePath = resolvePortableWorkspacePath(
    workspacePath,
    legacyPath,
  );
  const destinationPath = resolvePortableWorkspacePath(
    workspacePath,
    managedPath,
  );
  const [sourceStats, destinationStats] = await Promise.all([
    lstatIfPresent(sourcePath),
    lstatIfPresent(destinationPath),
  ]);

  if (!sourceStats) {
    if (
      destinationStats &&
      (destinationStats.isSymbolicLink() || !destinationStats.isFile())
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    await removeDirectoryIfEmpty(dirname(sourcePath));
    return;
  }
  if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  if (destinationStats) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await rename(sourcePath, destinationPath);
  await removeDirectoryIfEmpty(dirname(sourcePath));
}

export async function migrateProjectWorkspaceDataLayout(
  context: DatabaseContext,
): Promise<void> {
  const legacyAssets = context.sqlite
    .prepare<[], StoredContentRefRow>(
      `SELECT
         assets.id AS id,
         projects.workspace_path AS workspacePath,
         assets.content_ref AS contentRef
       FROM assets
       INNER JOIN projects ON projects.id = assets.project_id
       WHERE json_extract(assets.content_ref, '$.kind') = 'local-file'
         AND json_extract(assets.content_ref, '$.base') = 'project-workspace'
         AND (
           json_extract(assets.content_ref, '$.path') LIKE 'assets/imported/%'
           OR json_extract(assets.content_ref, '$.path') LIKE 'assets/generated/%'
         )`,
    )
    .all();
  const legacyAttachments = context.sqlite
    .prepare<[], StoredContentRefRow>(
      `SELECT
         asset_attachments.id AS id,
         projects.workspace_path AS workspacePath,
         asset_attachments.content_ref_json AS contentRef
       FROM asset_attachments
       INNER JOIN projects
         ON projects.id = asset_attachments.project_id
       WHERE asset_attachments.content_ref_json IS NOT NULL
         AND json_extract(
           asset_attachments.content_ref_json,
           '$.kind'
         ) = 'local-file'
         AND json_extract(
           asset_attachments.content_ref_json,
           '$.base'
         ) = 'project-workspace'
         AND json_extract(
           asset_attachments.content_ref_json,
           '$.path'
         ) LIKE 'attachments/%'`,
    )
    .all();
  const updateAsset = context.sqlite.prepare<[string, string, string]>(
    `UPDATE assets
     SET content_ref = ?
     WHERE id = ? AND content_ref = ?`,
  );
  const updateAttachment = context.sqlite.prepare<
    [string, string, string]
  >(
    `UPDATE asset_attachments
     SET content_ref_json = ?
     WHERE id = ? AND content_ref_json = ?`,
  );
  const legacyAssetWorkspaces = new Set<string>();
  const legacyAttachmentWorkspaces = new Set<string>();

  for (const row of legacyAssets) {
    const ref = parseLegacyRef(row.contentRef, LEGACY_ASSET_PREFIXES);
    const managedPath =
      `${PROJECT_WORKSPACE_METADATA_DIRECTORY}/${ref.path}`;
    await moveManagedFile(row.workspacePath, ref.path, managedPath);
    const result = updateAsset.run(
      JSON.stringify({ ...ref, path: managedPath }),
      row.id,
      row.contentRef,
    );
    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
    legacyAssetWorkspaces.add(row.workspacePath);
  }

  for (const row of legacyAttachments) {
    const ref = parseLegacyRef(row.contentRef, [LEGACY_ATTACHMENT_PREFIX]);
    const managedPath =
      `${PROJECT_WORKSPACE_METADATA_DIRECTORY}/${ref.path}`;
    await moveManagedFile(row.workspacePath, ref.path, managedPath);
    const result = updateAttachment.run(
      JSON.stringify({ ...ref, path: managedPath }),
      row.id,
      row.contentRef,
    );
    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
    legacyAttachmentWorkspaces.add(row.workspacePath);
  }

  for (const workspacePath of legacyAssetWorkspaces) {
    await removeDirectoryIfEmpty(
      resolvePortableWorkspacePath(workspacePath, 'assets'),
    );
  }
  for (const workspacePath of legacyAttachmentWorkspaces) {
    await removeDirectoryIfEmpty(
      resolvePortableWorkspacePath(workspacePath, 'attachments'),
    );
  }
}
