import { randomUUID } from 'node:crypto';

import { and, count, eq, inArray } from 'drizzle-orm';

import {
  isAssetContentRef,
  isAssetCreationKind,
} from '../../shared/assets';
import type { DatabaseContext } from '../database/database-context';
import { assets } from '../database/schema/assets';
import { AppError } from '../errors/app-error';
import {
  cloneAsset,
  createAssetSnapshot,
  type Asset,
  type CreateAssetInput,
  type UpdateAssetInput,
} from './asset';

export interface AssetDatabaseApi {
  listByProject(projectId: string): readonly Asset[];
  countByProjectIds(projectIds: readonly string[]): ReadonlyMap<string, number>;
  add(projectId: string, input: CreateAssetInput): Asset;
  update(
    projectId: string,
    assetId: string,
    changes: UpdateAssetInput,
  ): Asset;
  delete(projectId: string, assetId: string): void;
}

export interface AssetDatabaseDependencies {
  readonly createId: () => string;
  readonly now: () => number;
}

const mutableAssetFields = new Set<keyof UpdateAssetInput>([
  'name',
  'contentRef',
  'updatedTime',
]);

function requireId(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Asset ${field} 不能为空`);
  }

  return normalized;
}

function createAssetFromRow(row: typeof assets.$inferSelect): Asset {
  if (
    !isAssetContentRef(row.contentRef) ||
    !isAssetCreationKind(row.creationKind)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return createAssetSnapshot({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    mediaType: row.mediaType,
    creationKind: row.creationKind,
    contentRef: row.contentRef,
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
  });
}

export class AssetDatabase implements AssetDatabaseApi {
  private readonly dependencies: AssetDatabaseDependencies;

  constructor(
    private readonly context: DatabaseContext,
    dependencies: Partial<AssetDatabaseDependencies> = {},
  ) {
    this.dependencies = {
      createId: dependencies.createId ?? randomUUID,
      now: dependencies.now ?? Date.now,
    };
  }

  listByProject(projectId: string): readonly Asset[] {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const rows = this.context.db
      .select()
      .from(assets)
      .where(eq(assets.projectId, normalizedProjectId))
      .all();
    const assetIds = new Set<string>();
    const result: Asset[] = [];

    for (const row of rows) {
      const asset = createAssetFromRow(row);

      if (assetIds.has(asset.id)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      assetIds.add(asset.id);
      result.push(asset);
    }

    return result.map(cloneAsset);
  }

  countByProjectIds(projectIds: readonly string[]): ReadonlyMap<string, number> {
    const normalizedProjectIds = [
      ...new Set(
        projectIds.map((projectId) => requireId(projectId, 'projectId')),
      ),
    ];

    if (normalizedProjectIds.length === 0) {
      return new Map();
    }

    const rows = this.context.db
      .select({
        projectId: assets.projectId,
        assetCount: count(),
      })
      .from(assets)
      .where(inArray(assets.projectId, normalizedProjectIds))
      .groupBy(assets.projectId)
      .all();
    const counts = new Map(
      normalizedProjectIds.map((projectId) => [projectId, 0]),
    );

    for (const row of rows) {
      counts.set(row.projectId, row.assetCount);
    }

    return counts;
  }

  add(projectId: string, input: CreateAssetInput): Asset {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const now = this.dependencies.now();
    const asset = createAssetSnapshot({
      id: this.dependencies.createId(),
      projectId: normalizedProjectId,
      name: input.name,
      mediaType: input.mediaType,
      creationKind: input.creationKind,
      contentRef: input.contentRef,
      createdTime: now,
      updatedTime: now,
    });

    const result = this.context.db
      .insert(assets)
      .values({
        id: asset.id,
        projectId: asset.projectId,
        name: asset.name,
        mediaType: asset.mediaType,
        creationKind: asset.creationKind,
        contentRef: asset.contentRef,
        createdTime: asset.createdTime,
        updatedTime: asset.updatedTime,
      })
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return cloneAsset(asset);
  }

  update(
    projectId: string,
    assetId: string,
    changes: UpdateAssetInput,
  ): Asset {
    this.validateUpdate(changes);
    const normalizedProjectId = requireId(projectId, 'projectId');
    const normalizedAssetId = requireId(assetId, 'assetId');
    const currentAsset = this.find(normalizedProjectId, normalizedAssetId);
    const nextAsset = createAssetSnapshot({
      ...currentAsset,
      name: changes.name ?? currentAsset.name,
      contentRef: changes.contentRef ?? currentAsset.contentRef,
      updatedTime: changes.updatedTime ?? currentAsset.updatedTime,
    });
    const result = this.context.db
      .update(assets)
      .set({
        name: nextAsset.name,
        contentRef: nextAsset.contentRef,
        updatedTime: nextAsset.updatedTime,
      })
      .where(
        and(
          eq(assets.id, normalizedAssetId),
          eq(assets.projectId, normalizedProjectId),
        ),
      )
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return cloneAsset(nextAsset);
  }

  delete(projectId: string, assetId: string): void {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const normalizedAssetId = requireId(assetId, 'assetId');
    this.find(normalizedProjectId, normalizedAssetId);

    const result = this.context.db
      .delete(assets)
      .where(
        and(
          eq(assets.id, normalizedAssetId),
          eq(assets.projectId, normalizedProjectId),
        ),
      )
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
  }

  private find(projectId: string, assetId: string): Asset {
    const row = this.context.db
      .select()
      .from(assets)
      .where(
        and(eq(assets.id, assetId), eq(assets.projectId, projectId)),
      )
      .get();

    if (!row) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    return createAssetFromRow(row);
  }

  private validateUpdate(changes: UpdateAssetInput): void {
    const keys = Object.keys(changes);

    if (
      keys.length === 0 ||
      keys.some(
        (key) => !mutableAssetFields.has(key as keyof UpdateAssetInput),
      ) ||
      (changes.name === undefined &&
        changes.contentRef === undefined &&
        changes.updatedTime === undefined)
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
  }
}
