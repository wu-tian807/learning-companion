import { randomUUID } from 'node:crypto';

import { and, count, eq, inArray } from 'drizzle-orm';

import {
  type AssetContentRef,
} from '../content/content-ref';
import { isAssetContentRef } from '../../shared/assets';
import type { DatabaseContext } from '../database/database-context';
import { assets } from '../database/schema/assets';
import { AppError } from '../errors/app-error';
import type { ProjectLookup } from '../projects/project-database';
import {
  cloneAsset,
  createAssetSnapshot,
  type Asset,
  type CreateAssetInput,
  type UpdateAssetInput,
} from './asset';

export interface AssetDatabaseApi {
  loadFromProject(projectId: string): Promise<readonly Asset[]>;
  countByProjectIds(projectIds: readonly string[]): ReadonlyMap<string, number>;
  unloadProject(): void;
  getActiveProjectId(): string | undefined;
  list(): readonly Asset[];
  get(assetId: string): Asset | undefined;
  add(input: CreateAssetInput): Asset;
  update(assetId: string, changes: UpdateAssetInput): Asset;
  updateContentRef(assetId: string, contentRef: AssetContentRef): Asset;
  delete(assetId: string): void;
}

export interface AssetDatabaseDependencies {
  readonly createId: () => string;
  readonly now: () => number;
}

const mutableAssetFields = new Set<keyof UpdateAssetInput>([
  'name',
  'lastUsedTime',
]);

function requireId(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Asset ${field} 不能为空`);
  }

  return normalized;
}

export class AssetDatabase implements AssetDatabaseApi {
  private activeProjectId: string | undefined;
  private assetMap = new Map<string, Asset>();
  private readonly dependencies: AssetDatabaseDependencies;

  constructor(
    private readonly context: DatabaseContext,
    private readonly projectLookup: ProjectLookup,
    dependencies: Partial<AssetDatabaseDependencies> = {},
  ) {
    this.dependencies = {
      createId: dependencies.createId ?? randomUUID,
      now: dependencies.now ?? Date.now,
    };
  }

  async loadFromProject(projectId: string): Promise<readonly Asset[]> {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const project = this.projectLookup.get(normalizedProjectId);

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    const rows = this.context.db
      .select()
      .from(assets)
      .where(eq(assets.projectId, normalizedProjectId))
      .all();
    const nextAssetMap = new Map<string, Asset>();

    for (const row of rows) {
      if (!isAssetContentRef(row.contentRef)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const asset = createAssetSnapshot({
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        mediaType: row.mediaType,
        contentRef: row.contentRef,
        createdTime: row.createdTime,
        lastUsedTime: row.lastUsedTime,
      });

      if (nextAssetMap.has(asset.id)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      nextAssetMap.set(asset.id, asset);
    }

    this.activeProjectId = normalizedProjectId;
    this.assetMap = nextAssetMap;

    return this.list();
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

  unloadProject(): void {
    this.assetMap.clear();
    this.activeProjectId = undefined;
  }

  getActiveProjectId(): string | undefined {
    return this.activeProjectId;
  }

  list(): readonly Asset[] {
    this.requireActiveProjectId();
    return [...this.assetMap.values()].map(cloneAsset);
  }

  get(assetId: string): Asset | undefined {
    this.requireActiveProjectId();
    const asset = this.assetMap.get(assetId);
    return asset ? cloneAsset(asset) : undefined;
  }

  add(input: CreateAssetInput): Asset {
    const projectId = this.requireActiveProjectId();
    const now = this.dependencies.now();
    const asset = createAssetSnapshot({
      id: this.dependencies.createId(),
      projectId,
      name: input.name,
      mediaType: input.mediaType,
      contentRef: input.contentRef,
      createdTime: now,
      lastUsedTime: now,
    });

    if (this.assetMap.has(asset.id)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const result = this.context.db
      .insert(assets)
      .values({
        id: asset.id,
        projectId: asset.projectId,
        name: asset.name,
        mediaType: asset.mediaType,
        contentRef: asset.contentRef,
        createdTime: asset.createdTime,
        lastUsedTime: asset.lastUsedTime,
      })
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    this.assetMap.set(asset.id, asset);
    return cloneAsset(asset);
  }

  update(assetId: string, changes: UpdateAssetInput): Asset {
    this.validateUpdate(changes);
    const projectId = this.requireActiveProjectId();
    const currentAsset = this.find(assetId);
    const nextAsset = createAssetSnapshot({
      ...currentAsset,
      name: changes.name ?? currentAsset.name,
      lastUsedTime: changes.lastUsedTime ?? currentAsset.lastUsedTime,
    });
    const result = this.context.db
      .update(assets)
      .set({
        name: nextAsset.name,
        lastUsedTime: nextAsset.lastUsedTime,
      })
      .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)))
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    this.assetMap.set(assetId, nextAsset);
    return cloneAsset(nextAsset);
  }

  updateContentRef(assetId: string, contentRef: AssetContentRef): Asset {
    const projectId = this.requireActiveProjectId();
    const currentAsset = this.find(assetId);

    if (
      currentAsset.contentRef.kind !== contentRef.kind
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    const nextAsset = createAssetSnapshot({
      ...currentAsset,
      contentRef,
    });
    const result = this.context.db
      .update(assets)
      .set({ contentRef })
      .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)))
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    this.assetMap.set(assetId, nextAsset);
    return cloneAsset(nextAsset);
  }

  delete(assetId: string): void {
    const projectId = this.requireActiveProjectId();
    this.find(assetId);

    const result = this.context.db
      .delete(assets)
      .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)))
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    this.assetMap.delete(assetId);
  }

  private requireActiveProjectId(): string {
    if (!this.activeProjectId) {
      throw new AppError('SERVICE_NOT_READY');
    }

    return this.activeProjectId;
  }

  private find(assetId: string): Asset {
    const asset = this.assetMap.get(assetId);

    if (!asset) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    return asset;
  }

  private validateUpdate(changes: UpdateAssetInput): void {
    const keys = Object.keys(changes);

    if (
      keys.length === 0 ||
      keys.some(
        (key) => !mutableAssetFields.has(key as keyof UpdateAssetInput),
      ) ||
      (changes.name === undefined && changes.lastUsedTime === undefined)
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
  }
}
