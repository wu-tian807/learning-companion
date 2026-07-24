import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { DatabaseContext } from '../database/database-context';
import { assets } from '../database/schema/assets';
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
  unloadProject(): void;
  getActiveProjectId(): string | undefined;
  list(): readonly Asset[];
  get(assetId: string): Asset | undefined;
  add(input: CreateAssetInput): Promise<Asset>;
  update(assetId: string, changes: UpdateAssetInput): Asset;
  delete(assetId: string): void;
  refreshAvailability(assetId: string): Promise<Asset>;
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
      throw new Error('找不到指定的 Project');
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
          throw new Error(`Asset contentKind 无效：${row.contentKind}`);
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
        throw new Error(`数据库包含重复的 Asset ID：${asset.id}`);
      }

      nextAssetMap.set(asset.id, asset);
    }

    if (this.lifecycleVersion !== loadVersion) {
      throw new Error('AssetDatabase Project 加载已被替代');
    }

    this.activeProjectId = normalizedProjectId;
    this.assetMap = nextAssetMap;

    return this.list();
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
      throw new Error(
        `无法添加不可用的本地文件：${contentLocator.availability}`,
      );
    }

    const now = this.dependencies.now();
    const asset = createAssetSnapshot({
      id: this.dependencies.createId(),
      projectId,
      name: createDefaultAssetName(contentLocator.path),
      mediaType: detectAssetMediaType(contentLocator.path),
      contentLocator,
      createdTime: now,
      lastUsedTime: now,
    });

    if (this.assetMap.has(asset.id)) {
      throw new Error(`Asset ID 已存在：${asset.id}`);
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
      throw new Error(`Asset 创建影响了 ${result.changes} 行`);
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
      throw new Error(`Asset 更新影响了 ${result.changes} 行`);
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
      throw new Error(`Asset 删除影响了 ${result.changes} 行`);
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
      throw new Error(
        `无法重新定位到不可用的本地文件：${contentLocator.availability}`,
      );
    }

    if (
      !isAssetRelinkMediaCompatible(
        currentAsset.mediaType,
        currentAsset.contentLocator.path,
        contentLocator.path,
      )
    ) {
      throw new Error('重新定位的文件类型与原 Asset 不一致');
    }

    const result = this.context.db
      .update(assets)
      .set({ contentPath: contentLocator.path })
      .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)))
      .run();

    if (result.changes !== 1) {
      throw new Error(`Asset Relink 影响了 ${result.changes} 行`);
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
      throw new Error('AssetDatabase 尚未加载 Project');
    }

    return this.activeProjectId;
  }

  private find(assetId: string): Asset {
    const asset = this.assetMap.get(assetId);

    if (!asset) {
      throw new Error('找不到当前 Project 中指定的 Asset');
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
      throw new Error('AssetDatabase 当前 Project 已变化');
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
      throw new Error('Asset 更新内容无效');
    }
  }
}
