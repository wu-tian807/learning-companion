import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';

import {
  assetFolderName,
  assetFolderParentPath,
  assetFolderPathKey,
  cloneAssetFolderState,
  isAssetFolderPathWithin,
  joinAssetFolderPath,
  normalizeAssetFolderPath,
  rebaseAssetFolderPath,
  type AssetFolderState,
} from '../../shared/asset-folders';
import type { DatabaseContext } from '../database/database-context';
import {
  assetFolderAssignments,
  assetFolders,
} from '../database/schema/asset-folders';
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

interface StoredFolder {
  readonly id: string;
  readonly projectId: string;
  readonly path: string;
}

function requireText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError('INVALID_IPC_REQUEST');
  }
  return normalized;
}

export class AssetFolderDatabase implements AssetFolderDatabaseApi {
  constructor(private readonly context: DatabaseContext) {}

  list(projectId: string): AssetFolderState {
    const normalizedProjectId = requireText(projectId);
    const storedFolders = this.listStoredFolders(normalizedProjectId);
    const folders = storedFolders
      .map((folder) => ({
        projectId: folder.projectId,
        path: folder.path,
      }))
      .sort((left, right) =>
        left.path.localeCompare(right.path, 'zh-CN', {
          sensitivity: 'base',
          numeric: true,
        }),
      );
    const folderPathsById = new Map(
      storedFolders.map((folder) => [folder.id, folder.path]),
    );

    if (folderPathsById.size !== storedFolders.length) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const assignments = this.context.db
      .select({
        assetId: assetFolderAssignments.assetId,
        assetProjectId: assets.projectId,
        folderId: assetFolderAssignments.folderId,
        folderProjectId: assetFolders.projectId,
      })
      .from(assetFolderAssignments)
      .innerJoin(assets, eq(assetFolderAssignments.assetId, assets.id))
      .innerJoin(
        assetFolders,
        eq(assetFolderAssignments.folderId, assetFolders.id),
      )
      .where(eq(assets.projectId, normalizedProjectId))
      .all();
    const folderPathByAssetId: Record<string, string> = {};

    for (const assignment of assignments) {
      const path = folderPathsById.get(assignment.folderId);
      if (
        assignment.assetProjectId !== normalizedProjectId ||
        assignment.folderProjectId !== normalizedProjectId ||
        path === undefined
      ) {
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
    const normalizedProjectId = requireText(projectId);
    if (!this.findFolder(normalizedProjectId, path)) {
      throw new AppError('ASSET_FOLDER_NOT_FOUND');
    }
  }

  create(projectId: string, path: string): AssetFolderState {
    const normalizedProjectId = requireText(projectId);
    const requestedPath = normalizeAssetFolderPath(path);
    const storedFolders = this.listStoredFolders(normalizedProjectId);
    const parentPath = assetFolderParentPath(requestedPath);
    const parent =
      parentPath === null
        ? undefined
        : storedFolders.find(
            (folder) =>
              assetFolderPathKey(folder.path) ===
              assetFolderPathKey(parentPath),
          );
    if (parentPath !== null && !parent) {
      throw new AppError('ASSET_FOLDER_NOT_FOUND');
    }
    const normalizedPath =
      parent === undefined
        ? requestedPath
        : joinAssetFolderPath(parent.path, assetFolderName(requestedPath));
    const pathKey = assetFolderPathKey(normalizedPath);
    if (
      storedFolders.some(
        (folder) => assetFolderPathKey(folder.path) === pathKey,
      )
    ) {
      throw new AppError('ASSET_FOLDER_CONFLICT');
    }

    const result = this.context.db
      .insert(assetFolders)
      .values({
        id: randomUUID(),
        projectId: normalizedProjectId,
        path: normalizedPath,
      })
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
    const requestedNextPath = normalizeAssetFolderPath(nextPath);
    const storedFolders = this.listStoredFolders(normalizedProjectId);
    const source = storedFolders.find(
      (folder) =>
        assetFolderPathKey(folder.path) === assetFolderPathKey(normalizedPath),
    );
    if (!source) {
      throw new AppError('ASSET_FOLDER_NOT_FOUND');
    }

    const movingFolders = storedFolders.filter((folder) =>
      isAssetFolderPathWithin(folder.path, source.path),
    );
    const movingKeys = new Set(
      movingFolders.map((folder) => assetFolderPathKey(folder.path)),
    );
    const outsideFolders = storedFolders.filter(
      (folder) => !movingKeys.has(assetFolderPathKey(folder.path)),
    );
    const parentPath = assetFolderParentPath(requestedNextPath);
    const parent =
      parentPath === null
        ? undefined
        : outsideFolders.find(
            (folder) =>
              assetFolderPathKey(folder.path) ===
              assetFolderPathKey(parentPath),
          );
    if (
      parentPath !== null &&
      movingKeys.has(assetFolderPathKey(parentPath))
    ) {
      throw new AppError('ASSET_FOLDER_INVALID_MOVE');
    }
    if (parentPath !== null && !parent) {
      throw new AppError('ASSET_FOLDER_NOT_FOUND');
    }
    const normalizedNextPath =
      parent === undefined
        ? requestedNextPath
        : joinAssetFolderPath(parent.path, assetFolderName(requestedNextPath));
    if (source.path === normalizedNextPath) {
      return this.list(normalizedProjectId);
    }
    if (
      assetFolderPathKey(source.path) !==
        assetFolderPathKey(normalizedNextPath) &&
      isAssetFolderPathWithin(normalizedNextPath, source.path)
    ) {
      throw new AppError('ASSET_FOLDER_INVALID_MOVE');
    }

    const outsideKeys = new Set(
      outsideFolders.map((folder) => assetFolderPathKey(folder.path)),
    );
    const nextFolders = movingFolders.map((folder) => ({
      id: folder.id,
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

    this.context.db.transaction((transaction) => {
      for (const folder of nextFolders) {
        const result = transaction
          .update(assetFolders)
          .set({ path: folder.nextPath })
          .where(
            and(
              eq(assetFolders.id, folder.id),
              eq(assetFolders.projectId, normalizedProjectId),
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

    const targetFolder =
      folderPath === null
        ? undefined
        : this.findFolder(normalizedProjectId, folderPath);
    if (folderPath !== null && !targetFolder) {
      throw new AppError('ASSET_FOLDER_NOT_FOUND');
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

    if (targetFolder === undefined) {
      this.context.db
        .delete(assetFolderAssignments)
        .where(inArray(assetFolderAssignments.assetId, normalizedAssetIds))
        .run();
    } else {
      this.context.db
        .insert(assetFolderAssignments)
        .values(
          normalizedAssetIds.map((assetId) => ({
            assetId,
            folderId: targetFolder.id,
          })),
        )
        .onConflictDoUpdate({
          target: assetFolderAssignments.assetId,
          set: { folderId: targetFolder.id },
        })
        .run();
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
    const storedFolders = this.listStoredFolders(normalizedProjectId).filter(
      (folder) => isAssetFolderPathWithin(folder.path, normalizedPath),
    );
    if (storedFolders.length === 0) {
      throw new AppError('ASSET_FOLDER_NOT_FOUND');
    }
    if (
      Object.values(state.folderPathByAssetId).some((folderPath) =>
        isAssetFolderPathWithin(folderPath, normalizedPath),
      )
    ) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    const result = this.context.db
      .delete(assetFolders)
      .where(inArray(assetFolders.id, storedFolders.map((folder) => folder.id)))
      .run();
    if (result.changes !== storedFolders.length) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return this.list(normalizedProjectId);
  }

  private listStoredFolders(projectId: string): StoredFolder[] {
    return this.context.db
      .select({
        id: assetFolders.id,
        projectId: assetFolders.projectId,
        path: assetFolders.path,
      })
      .from(assetFolders)
      .where(eq(assetFolders.projectId, projectId))
      .all()
      .map((folder) => ({
        ...folder,
        path: normalizeAssetFolderPath(folder.path),
      }));
  }

  private findFolder(projectId: string, path: string): StoredFolder | undefined {
    const key = assetFolderPathKey(path);
    return this.listStoredFolders(projectId).find(
      (folder) => assetFolderPathKey(folder.path) === key,
    );
  }
}
