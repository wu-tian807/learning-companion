import {
  cloneAssetSnapshot,
  type Asset,
  type AssetSnapshot,
} from '../../shared/assets';
import {
  createLocalFileContentRef,
  LOCAL_FILE_CONTENT_KIND,
  type ResolvedAssetContent,
} from '../content/content-ref';
import type { ContentResolverRegistry } from '../content/content-resolver-registry';
import { AppError } from '../errors/app-error';
import type { UpdateAssetInput } from './asset';
import type { AssetDatabaseApi } from './asset-database';
import {
  createDefaultAssetName,
  detectAssetMediaType,
  isAssetRelinkMediaCompatible,
} from './asset-media-type';

export interface AssetServiceApi {
  loadFromProject(projectId: string): Promise<readonly AssetSnapshot[]>;
  countByProjectIds(projectIds: readonly string[]): ReadonlyMap<string, number>;
  unloadProject(): void;
  getActiveProjectId(): string | undefined;
  list(): readonly AssetSnapshot[];
  get(assetId: string): AssetSnapshot | undefined;
  addLocalFile(path: string): Promise<AssetSnapshot>;
  update(assetId: string, changes: UpdateAssetInput): AssetSnapshot;
  delete(assetId: string): void;
  refresh(assetId: string): Promise<AssetSnapshot>;
  refreshAll(): Promise<readonly AssetSnapshot[]>;
  relinkLocalFile(assetId: string, newPath: string): Promise<AssetSnapshot>;
  resolveContent(assetId: string): Promise<ResolvedAssetContent>;
}

export interface AssetServiceDependencies {
  readonly detectMediaType: typeof detectAssetMediaType;
  readonly createDefaultName: typeof createDefaultAssetName;
  readonly isRelinkMediaCompatible: typeof isAssetRelinkMediaCompatible;
}

function createSnapshot(
  asset: Asset,
  resolved: Pick<
    ResolvedAssetContent,
    'contentRef' | 'contentStatus'
  >,
): AssetSnapshot {
  return cloneAssetSnapshot({
    ...asset,
    contentRef: resolved.contentRef,
    contentStatus: resolved.contentStatus,
  });
}

export class AssetService implements AssetServiceApi {
  private runtimeMap = new Map<string, AssetSnapshot>();
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
  ): Promise<readonly AssetSnapshot[]> {
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
      resolved.map((snapshot) => [snapshot.id, snapshot]),
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

  list(): readonly AssetSnapshot[] {
    this.requireActiveProjectId();
    return [...this.runtimeMap.values()].map(cloneAssetSnapshot);
  }

  get(assetId: string): AssetSnapshot | undefined {
    this.requireActiveProjectId();
    const snapshot = this.runtimeMap.get(assetId);
    return snapshot ? cloneAssetSnapshot(snapshot) : undefined;
  }

  async addLocalFile(path: string): Promise<AssetSnapshot> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const contentRef = createLocalFileContentRef(path);
    const resolved = await this.resolverRegistry.resolve(contentRef);

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);

      if (resolved.contentStatus.availability !== 'available') {
        throw new AppError('ASSET_UNAVAILABLE');
      }

      const normalizedRef = resolved.contentRef;

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
      const snapshot = createSnapshot(asset, resolved);
      this.runtimeMap.set(asset.id, snapshot);

      return cloneAssetSnapshot(snapshot);
    } finally {
      await resolved.handle?.close();
    }
  }

  update(assetId: string, changes: UpdateAssetInput): AssetSnapshot {
    const current = this.find(assetId);
    const asset = this.assetDatabase.update(assetId, changes);
    const snapshot = cloneAssetSnapshot({
      ...asset,
      contentStatus: current.contentStatus,
    });
    this.runtimeMap.set(assetId, snapshot);
    return cloneAssetSnapshot(snapshot);
  }

  delete(assetId: string): void {
    this.find(assetId);
    this.assetDatabase.delete(assetId);
    this.runtimeMap.delete(assetId);
  }

  async refresh(assetId: string): Promise<AssetSnapshot> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const current = this.find(assetId);
    const resolved = await this.resolverRegistry.resolve(current.contentRef);

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);
      const snapshot = createSnapshot(current, resolved);
      this.runtimeMap.set(assetId, snapshot);
      return cloneAssetSnapshot(snapshot);
    } finally {
      await resolved.handle?.close();
    }
  }

  async refreshAll(): Promise<readonly AssetSnapshot[]> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const current = [...this.runtimeMap.values()];
    const resolved = await Promise.all(
      current.map(async (snapshot) => {
        const content = await this.resolverRegistry.resolve(
          snapshot.contentRef,
        );

        try {
          return createSnapshot(snapshot, content);
        } finally {
          await content.handle?.close();
        }
      }),
    );
    this.requireUnchangedProject(lifecycleVersion, projectId);

    this.runtimeMap = new Map(
      resolved.map((snapshot) => [snapshot.id, snapshot]),
    );
    return this.list();
  }

  async relinkLocalFile(
    assetId: string,
    newPath: string,
  ): Promise<AssetSnapshot> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const current = this.find(assetId);

    if (current.contentRef.kind !== LOCAL_FILE_CONTENT_KIND) {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }

    const contentRef = createLocalFileContentRef(newPath);
    const resolved = await this.resolverRegistry.resolve(contentRef);

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);

      if (resolved.contentStatus.availability !== 'available') {
        throw new AppError('ASSET_UNAVAILABLE');
      }

      if (resolved.contentRef.kind !== LOCAL_FILE_CONTENT_KIND) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      if (
        resolved.contentRef.path !== current.contentRef.path &&
        !(await this.dependencies.isRelinkMediaCompatible(
          current.mediaType,
          current.contentRef.path,
          resolved.contentRef.path,
        ))
      ) {
        throw new AppError('ASSET_MEDIA_TYPE_MISMATCH');
      }

      this.requireUnchangedProject(lifecycleVersion, projectId);
      const asset =
        resolved.contentRef.path === current.contentRef.path
          ? current
          : this.assetDatabase.updateContentRef(
              assetId,
              resolved.contentRef,
            );
      const snapshot = createSnapshot(asset, resolved);
      this.runtimeMap.set(assetId, snapshot);
      return cloneAssetSnapshot(snapshot);
    } finally {
      await resolved.handle?.close();
    }
  }

  async resolveContent(assetId: string): Promise<ResolvedAssetContent> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const asset = this.find(assetId);
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
  ): Promise<AssetSnapshot> {
    const resolved = await this.resolverRegistry.resolve(asset.contentRef);

    try {
      return createSnapshot(asset, resolved);
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

  private find(assetId: string): AssetSnapshot {
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
