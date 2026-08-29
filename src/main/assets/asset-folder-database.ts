import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import {
  assetFolderParentPath,
  assetFolderPathKey,
  cloneAssetFolderState,
  isAssetFolderPathWithin,
  normalizeAssetFolderPath,
  rebaseAssetFolderPath,
  type AssetFolderState,
} from '../../shared/asset-folders';
import type { DatabaseContext } from '../database/database-context';
import { assetFolders } from '../database/schema/asset-folders';
import { assets } from '../database/schema/assets';
import { AppError } from '../errors/app-error';

export interface AssetFolderDatabaseApi {
  list(projectId: string): AssetFolderState;
  requireFolder(projectId: string, path: string): void;
  create(projectId: string, path: string): AssetFolderState;
  update(
    projectId: string,
    path: string,
    nextPath: string,
  ): AssetFolderState;
  moveAssets(
    projectId: string,
    assetIds: readonly string[],
    folderPath: string | null,
  ): AssetFolderState;
  listAssetIdsInTree(projectId: string, path: string): readonly string[];
  deleteTree(projectId: string, path: string): AssetFolderState;
}

function requireText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError('INVALID_IPC_REQUEST');
  }
  return normalized;
}

function folderDepth(path: string): number {
  return path.split('/').length;
}

export class AssetFolderDatabase implements AssetFolderDatabaseApi {
  constructor(private readonly context: DatabaseContext) {}

  list(projectId: string): AssetFolderState {
    const normalizedProjectId = requireText(projectId);
    const folders = this.context.db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.projectId, normalizedProjectId))
      .all()
      .map((folder) => ({
        projectId: folder.projectId,
        path: normalizeAssetFolderPath(folder.path),
      }))
      .sort((left, right) =>
        left.path.localeCompare(right.path, 'zh-CN', {
          sensitivity: 'base',
          numeric: true,
        }),
      );
    const folderKeys = new Set<string>();

    for (const folder of folders) {
      const key = assetFolderPathKey(folder.path);
      if (folderKeys.has(key)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      folderKeys.add(key);
    }

    const assignments = this.context.db
      .select({
        assetId: assets.id,
        folderPath: assets.folderPath,
      })
      .from(assets)
      .where(
        and(
          eq(assets.projectId, normalizedProjectId),
          isNotNull(assets.folderPath),
        ),
      )
      .all();
    const folderPathByAssetId: Record<string, string> = {};

    for (const assignment of assignments) {
      const path = normalizeAssetFolderPath(assignment.folderPath!);
      if (!folderKeys.has(assetFolderPathKey(path))) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      folderPathByAssetId[assignment.assetId] = path;
    }

    return cloneAssetFolderState({
      projectId: normalizedProjectId,
      folders,
      folderPathByAssetId,
    });
  }

  requireFolder(projectId: string, path: string): void {
    const state = this.list(projectId);
    const key = assetFolderPathKey(path);
    if (!state.folders.some((folder) => assetFolderPathKey(folder.path) === key)) {
      throw new AppError('ASSET_FOLDER_NOT_FOUND');
    }
  }

  create(projectId: string, path: string): AssetFolderState {
    const normalizedProjectId = requireText(projectId);
    const normalizedPath = normalizeAssetFolderPath(path);
    const state = this.list(normalizedProjectId);
    const pathKey = assetFolderPathKey(normalizedPath);

    if (
      state.folders.some(
        (folder) => assetFolderPathKey(folder.path) === pathKey,
      )
    ) {
      throw new AppError('ASSET_FOLDER_CONFLICT');
    }

    const parentPath = assetFolderParentPath(normalizedPath);
    if (parentPath !== null) {
      this.requireFolder(normalizedProjectId, parentPath);
    }

    const result = this.context.db
      .insert(assetFolders)
      .values({ projectId: normalizedProjectId, path: normalizedPath })
      .run();
    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return this.list(normalizedProjectId);
  }

  update(
    projectId: string,
    path: string,
    nextPath: string,
  ): AssetFolderState {
    const normalizedProjectId = requireText(projectId);
    const normalizedPath = normalizeAssetFolderPath(path);
    const normalizedNextPath = normalizeAssetFolderPath(nextPath);
    const state = this.list(normalizedProjectId);
    const sourceKey = assetFolderPathKey(normalizedPath);
    const source = state.folders.find(
      (folder) => assetFolderPathKey(folder.path) === sourceKey,
    );

    if (!source) {
      throw new AppError('ASSET_FOLDER_NOT_FOUND');
    }
    if (source.path === normalizedNextPath) {
      return state;
    }

    const nextKey = assetFolderPathKey(normalizedNextPath);
    if (
      sourceKey !== nextKey &&
      isAssetFolderPathWithin(normalizedNextPath, source.path)
    ) {
      throw new AppError('ASSET_FOLDER_INVALID_MOVE');
    }

    const movingFolders = state.folders.filter((folder) =>
      isAssetFolderPathWithin(folder.path, source.path),
    );
    const movingKeys = new Set(
      movingFolders.map((folder) => assetFolderPathKey(folder.path)),
    );
    const outsideKeys = new Set(
      state.folders
        .filter((folder) => !movingKeys.has(assetFolderPathKey(folder.path)))
        .map((folder) => assetFolderPathKey(folder.path)),
    );
    const nextFolders = movingFolders.map((folder) => ({
      currentPath: folder.path,
      nextPath: rebaseAssetFolderPath(
        folder.path,
        source.path,
        normalizedNextPath,
      ),
    }));
    const nextKeys = new Set<string>();

    for (const folder of nextFolders) {
      const key = assetFolderPathKey(folder.nextPath);
      if (outsideKeys.has(key) || nextKeys.has(key)) {
        throw new AppError('ASSET_FOLDER_CONFLICT');
      }
      nextKeys.add(key);
    }

    const parentPath = assetFolderParentPath(normalizedNextPath);
    if (parentPath !== null) {
      const parentKey = assetFolderPathKey(parentPath);
      if (movingKeys.has(parentKey)) {
        throw new AppError('ASSET_FOLDER_INVALID_MOVE');
      }
      if (!outsideKeys.has(parentKey)) {
        throw new AppError('ASSET_FOLDER_NOT_FOUND');
      }
    }

    const assignments = Object.entries(state.folderPathByAssetId)
      .filter(([, folderPath]) =>
        isAssetFolderPathWithin(folderPath, source.path),
      )
      .map(([assetId, folderPath]) => ({
        assetId,
        folderPath: rebaseAssetFolderPath(
          folderPath,
          source.path,
          normalizedNextPath,
        ),
      }));

    this.context.db.transaction((transaction) => {
      for (const assignment of assignments) {
        const result = transaction
          .update(assets)
          .set({ folderPath: assignment.folderPath })
          .where(
            and(
              eq(assets.projectId, normalizedProjectId),
              eq(assets.id, assignment.assetId),
            ),
          )
          .run();
        if (result.changes !== 1) {
          throw new AppError('DATABASE_WRITE_CONFLICT');
        }
      }

      for (const folder of movingFolders) {
        const result = transaction
          .delete(assetFolders)
          .where(
            and(
              eq(assetFolders.projectId, normalizedProjectId),
              eq(assetFolders.path, folder.path),
            ),
          )
          .run();
        if (result.changes !== 1) {
          throw new AppError('DATABASE_WRITE_CONFLICT');
        }
      }

      for (const folder of [...nextFolders].sort(
        (left, right) => folderDepth(left.nextPath) - folderDepth(right.nextPath),
      )) {
        const result = transaction
          .insert(assetFolders)
          .values({
            projectId: normalizedProjectId,
            path: folder.nextPath,
          })
          .run();
        if (result.changes !== 1) {
          throw new AppError('DATABASE_WRITE_CONFLICT');
        }
      }
    });

    return this.list(normalizedProjectId);
  }

  moveAssets(
    projectId: string,
    assetIds: readonly string[],
    folderPath: string | null,
  ): AssetFolderState {
    const normalizedProjectId = requireText(projectId);
    const normalizedAssetIds = [
      ...new Set(assetIds.map((assetId) => requireText(assetId))),
    ];
    if (normalizedAssetIds.length === 0) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    const normalizedFolderPath =
      folderPath === null ? null : normalizeAssetFolderPath(folderPath);
    if (normalizedFolderPath !== null) {
      this.requireFolder(normalizedProjectId, normalizedFolderPath);
    }

    const rows = this.context.db
      .select({ id: assets.id, creationKind: assets.creationKind })
      .from(assets)
      .where(
        and(
          eq(assets.projectId, normalizedProjectId),
          inArray(assets.id, normalizedAssetIds),
        ),
      )
      .all();
    if (
      rows.length !== normalizedAssetIds.length ||
      rows.some((row) => row.creationKind !== 'imported')
    ) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    const result = this.context.db
      .update(assets)
      .set({ folderPath: normalizedFolderPath })
      .where(
        and(
          eq(assets.projectId, normalizedProjectId),
          inArray(assets.id, normalizedAssetIds),
        ),
      )
      .run();
    if (result.changes !== normalizedAssetIds.length) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return this.list(normalizedProjectId);
  }

  listAssetIdsInTree(projectId: string, path: string): readonly string[] {
    const normalizedProjectId = requireText(projectId);
    const normalizedPath = normalizeAssetFolderPath(path);
    this.requireFolder(normalizedProjectId, normalizedPath);
    return Object.entries(this.list(normalizedProjectId).folderPathByAssetId)
      .filter(([, folderPath]) =>
        isAssetFolderPathWithin(folderPath, normalizedPath),
      )
      .map(([assetId]) => assetId);
  }

  deleteTree(projectId: string, path: string): AssetFolderState {
    const normalizedProjectId = requireText(projectId);
    const normalizedPath = normalizeAssetFolderPath(path);
    const state = this.list(normalizedProjectId);
    const folders = state.folders.filter((folder) =>
      isAssetFolderPathWithin(folder.path, normalizedPath),
    );
    if (folders.length === 0) {
      throw new AppError('ASSET_FOLDER_NOT_FOUND');
    }
    if (
      Object.values(state.folderPathByAssetId).some((folderPath) =>
        isAssetFolderPathWithin(folderPath, normalizedPath),
      )
    ) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    this.context.db.transaction((transaction) => {
      for (const folder of [...folders].sort(
        (left, right) => folderDepth(right.path) - folderDepth(left.path),
      )) {
        const result = transaction
          .delete(assetFolders)
          .where(
            and(
              eq(assetFolders.projectId, normalizedProjectId),
              eq(assetFolders.path, folder.path),
            ),
          )
          .run();
        if (result.changes !== 1) {
          throw new AppError('DATABASE_WRITE_CONFLICT');
        }
      }
    });

    return this.list(normalizedProjectId);
  }
}
