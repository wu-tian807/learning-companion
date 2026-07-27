import {
  cloneAssetContentRef,
  createAssetContentStatus,
  createLocalFileContentRef,
  LOCAL_FILE_CONTENT_KIND,
  type AssetContentStatus,
  type ResolvedAssetContent,
} from '../content/content-ref';
import type { ContentResolverRegistry } from '../content/content-resolver-registry';
import { AppError } from '../errors/app-error';
import { cloneAsset, type Asset, type UpdateAssetInput } from './asset';
import type { AssetDatabaseApi } from './asset-database';
import {
  createDefaultAssetName,
  detectAssetMediaType,
  isAssetRelinkMediaCompatible,
} from './asset-media-type';

export interface AssetRuntimeContent {
  readonly ref: Asset['contentRef'];
  readonly status: AssetContentStatus;
}

export interface AssetRuntimeSnapshot {
  readonly asset: Asset;
  readonly content: AssetRuntimeContent;
}

export interface AssetServiceApi {
  loadFromProject(projectId: string): Promise<readonly AssetRuntimeSnapshot[]>;
  countByProjectIds(projectIds: readonly string[]): ReadonlyMap<string, number>;
  unloadProject(): void;
  getActiveProjectId(): string | undefined;
  list(): readonly AssetRuntimeSnapshot[];
  get(assetId: string): AssetRuntimeSnapshot | undefined;
  addLocalFile(path: string): Promise<AssetRuntimeSnapshot>;
  update(
    assetId: string,
    changes: UpdateAssetInput,
  ): AssetRuntimeSnapshot;
  delete(assetId: string): void;
  refresh(assetId: string): Promise<AssetRuntimeSnapshot>;
  refreshAll(): Promise<readonly AssetRuntimeSnapshot[]>;
  relinkLocalFile(
    assetId: string,
    newPath: string,
  ): Promise<AssetRuntimeSnapshot>;
  resolveContent(assetId: string): Promise<ResolvedAssetContent>;
}

export interface AssetServiceDependencies {
  readonly detectMediaType: typeof detectAssetMediaType;
  readonly createDefaultName: typeof createDefaultAssetName;
  readonly isRelinkMediaCompatible: typeof isAssetRelinkMediaCompatible;
}

function cloneRuntimeContent(
  content: AssetRuntimeContent,
): AssetRuntimeContent {
  return Object.freeze({
    ref: cloneAssetContentRef(content.ref),
    status: createAssetContentStatus(
      content.status.availability,
      content.status.checkedTime,
    ),
  });
}

function createRuntimeSnapshot(
  asset: Asset,
  resolved: Pick<ResolvedAssetContent, 'ref' | 'status'>,
): AssetRuntimeSnapshot {
  return Object.freeze({
    asset: cloneAsset(asset),
    content: cloneRuntimeContent(resolved),
  });
}

function cloneRuntimeSnapshot(
  snapshot: AssetRuntimeSnapshot,
): AssetRuntimeSnapshot {
  return createRuntimeSnapshot(snapshot.asset, snapshot.content);
}

export class AssetService implements AssetServiceApi {
  private runtimeMap = new Map<string, AssetRuntimeSnapshot>();
  private lifecycleVersion = 0;
  private readonly dependencies: AssetServiceDependencies;

  constructor(
    private readonly assetDatabase: AssetDatabaseApi,
    private readonly resolverRegistry: ContentResolverRegistry,
    dependencies: Partial<AssetServiceDependencies> = {},
  ) {
    this.dependencies = {
      detectMediaType: dependencies.detectMediaType ?? detectAssetMediaType,
      createDefaultName:
        dependencies.createDefaultName ?? createDefaultAssetName,
      isRelinkMediaCompatible:
        dependencies.isRelinkMediaCompatible ??
        isAssetRelinkMediaCompatible,
    };
  }

  async loadFromProject(
    projectId: string,
  ): Promise<readonly AssetRuntimeSnapshot[]> {
    const loadVersion = this.lifecycleVersion + 1;
    this.lifecycleVersion = loadVersion;
    const assets = await this.assetDatabase.loadFromProject(projectId);
    const resolved = await Promise.all(
      assets.map((asset) => this.resolveRuntimeSnapshot(asset)),
    );

    if (
      this.lifecycleVersion !== loadVersion ||
      this.assetDatabase.getActiveProjectId() !== projectId
    ) {
      throw new AppError('OPERATION_SUPERSEDED');
    }

    this.runtimeMap = new Map(
      resolved.map((snapshot) => [snapshot.asset.id, snapshot]),
    );

    return this.list();
  }

  countByProjectIds(
    projectIds: readonly string[],
  ): ReadonlyMap<string, number> {
    return this.assetDatabase.countByProjectIds(projectIds);
  }

  unloadProject(): void {
    this.lifecycleVersion += 1;
    this.runtimeMap.clear();
    this.assetDatabase.unloadProject();
  }

  getActiveProjectId(): string | undefined {
    return this.assetDatabase.getActiveProjectId();
  }

  list(): readonly AssetRuntimeSnapshot[] {
    this.requireActiveProjectId();
    return [...this.runtimeMap.values()].map(cloneRuntimeSnapshot);
  }

  get(assetId: string): AssetRuntimeSnapshot | undefined {
    this.requireActiveProjectId();
    const snapshot = this.runtimeMap.get(assetId);
    return snapshot ? cloneRuntimeSnapshot(snapshot) : undefined;
  }

  async addLocalFile(path: string): Promise<AssetRuntimeSnapshot> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const contentRef = createLocalFileContentRef(path);
    const resolved = await this.resolverRegistry.resolve(contentRef);

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);

      if (resolved.status.availability !== 'available') {
        throw new AppError('ASSET_UNAVAILABLE');
      }

      const normalizedRef = resolved.ref;

      if (normalizedRef.kind !== LOCAL_FILE_CONTENT_KIND) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const mediaType = await this.dependencies.detectMediaType(
        normalizedRef.path,
      );
      this.requireUnchangedProject(lifecycleVersion, projectId);
      const asset = this.assetDatabase.add({
        name: this.dependencies.createDefaultName(normalizedRef.path),
        mediaType,
        contentRef: normalizedRef,
      });
      const snapshot = createRuntimeSnapshot(asset, resolved);
      this.runtimeMap.set(asset.id, snapshot);

      return cloneRuntimeSnapshot(snapshot);
    } finally {
      await resolved.handle?.close();
    }
  }

  update(
    assetId: string,
    changes: UpdateAssetInput,
  ): AssetRuntimeSnapshot {
    const current = this.find(assetId);
    const asset = this.assetDatabase.update(assetId, changes);
    const snapshot = createRuntimeSnapshot(asset, current.content);
    this.runtimeMap.set(assetId, snapshot);
    return cloneRuntimeSnapshot(snapshot);
  }

  delete(assetId: string): void {
    this.find(assetId);
    this.assetDatabase.delete(assetId);
    this.runtimeMap.delete(assetId);
  }

  async refresh(assetId: string): Promise<AssetRuntimeSnapshot> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const current = this.find(assetId);
    const resolved = await this.resolverRegistry.resolve(
      current.asset.contentRef,
    );

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);
      const snapshot = createRuntimeSnapshot(current.asset, resolved);
      this.runtimeMap.set(assetId, snapshot);
      return cloneRuntimeSnapshot(snapshot);
    } finally {
      await resolved.handle?.close();
    }
  }

  async refreshAll(): Promise<readonly AssetRuntimeSnapshot[]> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const current = [...this.runtimeMap.values()];
    const resolved = await Promise.all(
      current.map(async (snapshot) => {
        const content = await this.resolverRegistry.resolve(
          snapshot.asset.contentRef,
        );

        try {
          return createRuntimeSnapshot(snapshot.asset, content);
        } finally {
          await content.handle?.close();
        }
      }),
    );
    this.requireUnchangedProject(lifecycleVersion, projectId);

    this.runtimeMap = new Map(
      resolved.map((snapshot) => [snapshot.asset.id, snapshot]),
    );
    return this.list();
  }

  async relinkLocalFile(
    assetId: string,
    newPath: string,
  ): Promise<AssetRuntimeSnapshot> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const current = this.find(assetId);

    if (current.asset.contentRef.kind !== LOCAL_FILE_CONTENT_KIND) {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }

    const contentRef = createLocalFileContentRef(newPath);
    const resolved = await this.resolverRegistry.resolve(contentRef);

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);

      if (resolved.status.availability !== 'available') {
        throw new AppError('ASSET_UNAVAILABLE');
      }

      if (resolved.ref.kind !== LOCAL_FILE_CONTENT_KIND) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      if (
        resolved.ref.path !== current.asset.contentRef.path &&
        !(await this.dependencies.isRelinkMediaCompatible(
          current.asset.mediaType,
          current.asset.contentRef.path,
          resolved.ref.path,
        ))
      ) {
        throw new AppError('ASSET_MEDIA_TYPE_MISMATCH');
      }

      this.requireUnchangedProject(lifecycleVersion, projectId);
      const asset =
        resolved.ref.path === current.asset.contentRef.path
          ? current.asset
          : this.assetDatabase.updateContentRef(assetId, resolved.ref);
      const snapshot = createRuntimeSnapshot(asset, resolved);
      this.runtimeMap.set(assetId, snapshot);
      return cloneRuntimeSnapshot(snapshot);
    } finally {
      await resolved.handle?.close();
    }
  }

  async resolveContent(assetId: string): Promise<ResolvedAssetContent> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const asset = this.find(assetId).asset;
    const resolved = await this.resolverRegistry.resolve(asset.contentRef);

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);
      return resolved;
    } catch (error) {
      await resolved.handle?.close();
      throw error;
    }
  }

  private async resolveRuntimeSnapshot(
    asset: Asset,
  ): Promise<AssetRuntimeSnapshot> {
    const resolved = await this.resolverRegistry.resolve(asset.contentRef);

    try {
      return createRuntimeSnapshot(asset, resolved);
    } finally {
      await resolved.handle?.close();
    }
  }

  private requireActiveProjectId(): string {
    const projectId = this.assetDatabase.getActiveProjectId();

    if (!projectId) {
      throw new AppError('SERVICE_NOT_READY');
    }

    return projectId;
  }

  private find(assetId: string): AssetRuntimeSnapshot {
    const snapshot = this.runtimeMap.get(assetId);

    if (!snapshot) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    return snapshot;
  }

  private requireUnchangedProject(
    lifecycleVersion: number,
    projectId: string,
  ): void {
    if (
      this.lifecycleVersion !== lifecycleVersion ||
      this.assetDatabase.getActiveProjectId() !== projectId
    ) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }
  }
}
