import { randomUUID } from 'node:crypto';

import { and, count, eq, inArray } from 'drizzle-orm';

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
import {
  DefaultLocalFileLocatorChecker,
  LOCAL_FILE_CONTENT_KIND,
  type LocalFileLocatorChecker,
} from './asset-content-locator';
import {
  createDefaultAssetName,
  detectAssetMediaType,
  isAssetRelinkMediaCompatible,
} from './asset-media-type';

export interface AssetDatabaseApi {
  loadFromProject(projectId: string): Promise<readonly Asset[]>;
  countByProjectIds(projectIds: readonly string[]): ReadonlyMap<string, number>;
  unloadProject(): void;
  getActiveProjectId(): string | undefined;
  list(): readonly Asset[];
  get(assetId: string): Asset | undefined;
  add(input: CreateAssetInput): Promise<Asset>;
  update(assetId: string, changes: UpdateAssetInput): Asset;
  delete(assetId: string): void;
  refreshAvailability(assetId: string): Promise<Asset>;
  refreshAllAvailabilities(): Promise<readonly Asset[]>;
  relink(assetId: string, newPath: string): Promise<Asset>;
}

export interface AssetDatabaseDependencies {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly locatorChecker: LocalFileLocatorChecker;
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
  private lifecycleVersion = 0;
  private readonly dependencies: AssetDatabaseDependencies;

  constructor(
    private readonly context: DatabaseContext,
    private readonly projectLookup: ProjectLookup,
    dependencies: Partial<AssetDatabaseDependencies> = {},
  ) {
    const now = dependencies.now ?? (() => new Date());

    this.dependencies = {
      createId: dependencies.createId ?? randomUUID,
      now,
      locatorChecker:
        dependencies.locatorChecker ??
        new DefaultLocalFileLocatorChecker({ now }),
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
    const loadVersion = this.lifecycleVersion + 1;
    this.lifecycleVersion = loadVersion;
    const loadedAssets = await Promise.all(
      rows.map(async (row) => {
        if (row.contentKind !== LOCAL_FILE_CONTENT_KIND) {
          throw new AppError('DATA_INTEGRITY_ERROR');
        }

        const contentLocator = await this.dependencies.locatorChecker.check(
          row.contentPath,
        );

        return createAssetSnapshot({
          id: row.id,
          projectId: row.projectId,
          name: row.name,
          mediaType: row.mediaType,
          contentLocator,
          createdTime: row.createdTime,
          lastUsedTime: row.lastUsedTime,
        });
      }),
    );
    const nextAssetMap = new Map<string, Asset>();

    for (const asset of loadedAssets) {
      if (nextAssetMap.has(asset.id)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      nextAssetMap.set(asset.id, asset);
    }

    if (this.lifecycleVersion !== loadVersion) {
      throw new AppError('OPERATION_SUPERSEDED');
    }

    this.activeProjectId = normalizedProjectId;
    this.assetMap = nextAssetMap;

    return this.list();
  }

  countByProjectIds(projectIds: readonly string[]): ReadonlyMap<string, number> {
    const normalizedProjectIds = [
      ...new Set(projectIds.map((projectId) => requireId(projectId, 'projectId'))),
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
    this.lifecycleVersion += 1;
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

  async add(input: CreateAssetInput): Promise<Asset> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const contentLocator = await this.dependencies.locatorChecker.check(
      input.path,
    );
    this.requireUnchangedProject(lifecycleVersion, projectId);

    if (contentLocator.availability !== 'available') {
      throw new AppError('ASSET_UNAVAILABLE');
    }

    const now = this.dependencies.now();
    const asset = createAssetSnapshot({
      id: this.dependencies.createId(),
      projectId,
      name: createDefaultAssetName(contentLocator.path),
      mediaType: await detectAssetMediaType(contentLocator.path),
      contentLocator,
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
        contentKind: asset.contentLocator.kind,
        contentPath: asset.contentLocator.path,
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

  async refreshAvailability(assetId: string): Promise<Asset> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const currentAsset = this.find(assetId);
    const contentLocator = await this.dependencies.locatorChecker.check(
      currentAsset.contentLocator.path,
    );
    this.requireUnchangedProject(lifecycleVersion, projectId);
    const nextAsset = createAssetSnapshot({
      ...currentAsset,
      contentLocator,
    });

    this.assetMap.set(assetId, nextAsset);
    return cloneAsset(nextAsset);
  }

  async refreshAllAvailabilities(): Promise<readonly Asset[]> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const currentAssets = [...this.assetMap.values()];
    const refreshedAssets = await Promise.all(
      currentAssets.map(async (asset) =>
        createAssetSnapshot({
          ...asset,
          contentLocator: await this.dependencies.locatorChecker.check(
            asset.contentLocator.path,
          ),
        }),
      ),
    );
    this.requireUnchangedProject(lifecycleVersion, projectId);

    for (const asset of refreshedAssets) {
      this.assetMap.set(asset.id, asset);
    }

    return this.list();
  }

  async relink(assetId: string, newPath: string): Promise<Asset> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const currentAsset = this.find(assetId);
    const contentLocator =
      await this.dependencies.locatorChecker.check(newPath);
    this.requireUnchangedProject(lifecycleVersion, projectId);

    if (contentLocator.path === currentAsset.contentLocator.path) {
      const nextAsset = createAssetSnapshot({
        ...currentAsset,
        contentLocator,
      });

      this.assetMap.set(assetId, nextAsset);
      return cloneAsset(nextAsset);
    }

    if (contentLocator.availability !== 'available') {
      throw new AppError('ASSET_UNAVAILABLE');
    }

    if (
      !(await isAssetRelinkMediaCompatible(
        currentAsset.mediaType,
        currentAsset.contentLocator.path,
        contentLocator.path,
      ))
    ) {
      throw new AppError('ASSET_MEDIA_TYPE_MISMATCH');
    }

    const result = this.context.db
      .update(assets)
      .set({ contentPath: contentLocator.path })
      .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)))
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    const nextAsset = createAssetSnapshot({
      ...currentAsset,
      contentLocator,
    });
    this.assetMap.set(assetId, nextAsset);
    return cloneAsset(nextAsset);
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

  private requireUnchangedProject(
    lifecycleVersion: number,
    projectId: string,
  ): void {
    if (
      this.lifecycleVersion !== lifecycleVersion ||
      this.activeProjectId !== projectId
    ) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }
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
