import {
  cloneAssetSnapshot,
  cloneAssetContentStatus,
  type AssetChangedEvent,
  type AssetContentStatus,
  type Asset,
  type AssetSnapshot,
  type LocalAssetImportMode,
} from '../../shared/assets';
import {
  LOCAL_FILE_CONTENT_KIND,
  type ResolvedAssetContent,
} from '../content/content-ref';
import type {
  ContentResolveContext,
  ContentResolverRegistry,
} from '../content/content-resolver-registry';
import { createTrackedContentHandle } from '../content/tracked-content-handle';
import { AppError } from '../errors/app-error';
import type { AssetArtifactCleanupApi } from '../artifacts/asset-artifact-service';
import type { ProjectLookup } from '../projects/project-database';
import type { ProjectWorkspaceManagerApi } from '../projects/project-workspace-manager';
import {
  createAssetSnapshot,
  type AssetUpdateTiming,
  type PersistAssetUpdateInput,
  type UpdateAssetInput,
} from './asset';
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
  selectLocalFiles(projectId: string): Promise<readonly string[]>;
  addLocalFile(
    projectId: string,
    path: string,
    mode?: LocalAssetImportMode,
  ): Promise<AssetSnapshot>;
  update(
    assetId: string,
    changes: UpdateAssetInput,
    options?: AssetServiceUpdateOptions,
  ): AssetSnapshot;
  delete(assetId: string): Promise<void>;
  cleanupProjectArtifacts(
    projectId: string,
    workspacePath: string,
  ): Promise<void>;
  refresh(assetId: string): Promise<AssetSnapshot>;
  refreshAll(): Promise<readonly AssetSnapshot[]>;
  relinkLocalFile(assetId: string, newPath: string): Promise<AssetSnapshot>;
  resolveContent(assetId: string): Promise<ResolvedAssetContent>;
  revealInFolder(assetId: string): Promise<void>;
  subscribe(listener: AssetChangedListener): () => void;
}

export type AssetChangedListener = (event: AssetChangedEvent) => void;

export interface AssetServiceDependencies {
  readonly detectMediaType: typeof detectAssetMediaType;
  readonly createDefaultName: typeof createDefaultAssetName;
  readonly isRelinkMediaCompatible: typeof isAssetRelinkMediaCompatible;
  readonly artifactCleanup?: AssetArtifactCleanupApi;
  readonly now: () => number;
}

export interface AssetServiceUpdateOptions {
  readonly contentStatus?: AssetContentStatus;
}

interface ResolvedRuntimeAsset {
  readonly snapshot: AssetSnapshot;
  readonly observedUpdatedTime?: number;
}

function isUnixMilliseconds(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSameContentRef(
  left: Asset['contentRef'],
  right: Asset['contentRef'],
): boolean {
  return (
    left.kind === right.kind &&
    left.base === right.base &&
    left.path === right.path
  );
}

function isSameContentStatus(
  left: AssetContentStatus,
  right: AssetContentStatus,
): boolean {
  return (
    left.availability === right.availability &&
    left.checkedTime === right.checkedTime
  );
}

function normalizeUpdateTiming(
  currentUpdatedTime: number,
  timing: AssetUpdateTiming | undefined,
  hasDirectChange: boolean,
  now: number,
): number | undefined {
  if (!isUnixMilliseconds(now)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  if (!hasDirectChange && timing === undefined) {
    return undefined;
  }

  let candidate = now;

  if (!hasDirectChange && timing?.mode === 'observed') {
    if (!isUnixMilliseconds(timing.observedTime)) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    candidate = Math.min(timing.observedTime, now);
  }

  return Math.max(currentUpdatedTime, candidate);
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
  private activeProjectId: string | undefined;
  private runtimeMap = new Map<string, AssetSnapshot>();
  private lifecycleVersion = 0;
  private readonly listeners = new Set<AssetChangedListener>();
  private readonly dependencies: AssetServiceDependencies;

  constructor(
    private readonly assetDatabase: AssetDatabaseApi,
    private readonly resolverRegistry: ContentResolverRegistry,
    private readonly projectLookup: ProjectLookup,
    private readonly workspaceManager: ProjectWorkspaceManagerApi,
    dependencies: Partial<AssetServiceDependencies> = {},
  ) {
    this.dependencies = {
      detectMediaType: dependencies.detectMediaType ?? detectAssetMediaType,
      createDefaultName:
        dependencies.createDefaultName ?? createDefaultAssetName,
      isRelinkMediaCompatible:
        dependencies.isRelinkMediaCompatible ??
        isAssetRelinkMediaCompatible,
      artifactCleanup: dependencies.artifactCleanup,
      now: dependencies.now ?? Date.now,
    };
  }

  async loadFromProject(
    projectId: string,
  ): Promise<readonly AssetSnapshot[]> {
    const loadVersion = this.lifecycleVersion + 1;
    this.lifecycleVersion = loadVersion;
    this.activeProjectId = undefined;
    this.runtimeMap.clear();
    const context = this.createResolveContext(projectId);
    const assets = this.assetDatabase.listByProject(projectId);
    const resolved = await Promise.all(
      assets.map((asset) => this.resolveRuntimeSnapshot(asset, context)),
    );

    if (this.lifecycleVersion !== loadVersion) {
      throw new AppError('OPERATION_SUPERSEDED');
    }

    this.activeProjectId = projectId;
    this.runtimeMap = new Map(
      resolved.map(({ snapshot }) => [snapshot.id, snapshot]),
    );
    for (const item of resolved) {
      this.synchronizeObservedUpdatedTime(
        item.snapshot.id,
        item.observedUpdatedTime,
        'loadFromProject',
      );
    }

    return this.list();
  }

  countByProjectIds(
    projectIds: readonly string[],
  ): ReadonlyMap<string, number> {
    return this.assetDatabase.countByProjectIds(projectIds);
  }

  unloadProject(): void {
    this.lifecycleVersion += 1;
    this.activeProjectId = undefined;
    this.runtimeMap.clear();
  }

  getActiveProjectId(): string | undefined {
    return this.activeProjectId;
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

  async selectLocalFiles(
    projectId: string,
  ): Promise<readonly string[]> {
    const project = this.projectLookup.get(projectId);

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    await this.workspaceManager.validateWorkspace({
      projectId,
      workspacePath: project.workspacePath,
    });
    return this.workspaceManager.selectAssetFiles(project.workspacePath);
  }

  async addLocalFile(
    projectId: string,
    path: string,
    mode: LocalAssetImportMode = 'copy',
  ): Promise<AssetSnapshot> {
    this.requireExpectedProject(projectId);
    const lifecycleVersion = this.lifecycleVersion;
    const context = this.createResolveContext(projectId);
    await this.workspaceManager.validateWorkspace({
      projectId,
      workspacePath: context.projectWorkspace,
    });
    const imported =
      mode === 'copy'
        ? await this.workspaceManager.copyImportedFile(
            context.projectWorkspace,
            path,
          )
        : {
            contentRef: await this.workspaceManager.classifyLocalFile(
              context.projectWorkspace,
              path,
            ),
          };
    let resolved: ResolvedAssetContent | undefined;

    try {
      resolved = await this.resolverRegistry.resolve(
        imported.contentRef,
        context,
      );
      this.requireUnchangedProject(lifecycleVersion, projectId);

      if (resolved.contentStatus.availability !== 'available') {
        throw new AppError('ASSET_UNAVAILABLE');
      }

      const normalizedRef = resolved.contentRef;

      if (
        normalizedRef.kind !== LOCAL_FILE_CONTENT_KIND ||
        !resolved.location
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const mediaType = await this.dependencies.detectMediaType(
        resolved.location.absolutePath,
      );
      this.requireUnchangedProject(lifecycleVersion, projectId);
      const asset = this.assetDatabase.add(projectId, {
        name: this.dependencies.createDefaultName(
          resolved.location.absolutePath,
        ),
        mediaType,
        creationKind: 'imported',
        contentRef: normalizedRef,
      });
      const snapshot = createSnapshot(asset, resolved);
      this.runtimeMap.set(asset.id, snapshot);

      return cloneAssetSnapshot(snapshot);
    } catch (error) {
      if (imported.copiedAbsolutePath) {
        await this.workspaceManager
          .removeImportedFile(imported.copiedAbsolutePath)
          .catch((cleanupError: unknown) => {
            console.error('清理导入失败的 Asset 文件失败', cleanupError);
          });
      }
      throw error;
    } finally {
      await resolved?.handle?.close();
    }
  }

  update(
    assetId: string,
    changes: UpdateAssetInput,
    options: AssetServiceUpdateOptions = {},
  ): AssetSnapshot {
    const projectId = this.requireActiveProjectId();
    const current = this.find(assetId);
    const candidate = createAssetSnapshot({
      ...current,
      name: changes.name ?? current.name,
      contentRef: changes.contentRef ?? current.contentRef,
    });
    const nameChanged = candidate.name !== current.name;
    const contentRefChanged = !isSameContentRef(
      candidate.contentRef,
      current.contentRef,
    );
    const updatedTime = normalizeUpdateTiming(
      current.updatedTime,
      changes.updatedTime,
      nameChanged || contentRefChanged,
      this.dependencies.now(),
    );
    const updatedTimeChanged =
      updatedTime !== undefined && updatedTime !== current.updatedTime;
    const nextContentStatus = options.contentStatus
      ? cloneAssetContentStatus(options.contentStatus)
      : current.contentStatus;
    const contentStatusChanged = !isSameContentStatus(
      nextContentStatus,
      current.contentStatus,
    );
    const persistenceChanges: PersistAssetUpdateInput = {
      ...(nameChanged ? { name: candidate.name } : {}),
      ...(contentRefChanged ? { contentRef: candidate.contentRef } : {}),
      ...(updatedTimeChanged ? { updatedTime } : {}),
    };
    const hasPersistenceChanges =
      Object.keys(persistenceChanges).length > 0;

    if (!hasPersistenceChanges && !contentStatusChanged) {
      return cloneAssetSnapshot(current);
    }

    const asset = hasPersistenceChanges
      ? this.assetDatabase.update(
          projectId,
          assetId,
          persistenceChanges,
        )
      : current;
    const snapshot = cloneAssetSnapshot({
      ...asset,
      contentStatus: nextContentStatus,
    });
    this.runtimeMap.set(assetId, snapshot);
    this.publishChanged(snapshot);
    return cloneAssetSnapshot(snapshot);
  }

  async delete(assetId: string): Promise<void> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    this.find(assetId);
    const project = this.projectLookup.get(projectId);

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    await this.dependencies.artifactCleanup?.removeByAsset(
      assetId,
      project.workspacePath,
    );
    this.requireUnchangedProject(lifecycleVersion, projectId);
    this.assetDatabase.delete(projectId, assetId);
    this.runtimeMap.delete(assetId);
  }

  async cleanupProjectArtifacts(
    projectId: string,
    workspacePath: string,
  ): Promise<void> {
    await this.dependencies.artifactCleanup?.removeByProject(
      projectId,
      workspacePath,
    );
  }

  async refresh(assetId: string): Promise<AssetSnapshot> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const current = this.find(assetId);
    const resolved = await this.resolverRegistry.resolve(
      current.contentRef,
      this.createResolveContext(projectId),
    );

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);
      this.requireCurrentSnapshot(assetId, current);
      this.update(assetId, {}, {
        contentStatus: resolved.contentStatus,
      });
      this.synchronizeObservedUpdatedTime(
        assetId,
        resolved.observedUpdatedTime,
        'refresh',
      );
      return this.findClone(assetId);
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
          this.createResolveContext(projectId),
        );

        try {
          return {
            snapshot: createSnapshot(snapshot, content),
            observedUpdatedTime: content.observedUpdatedTime,
          } satisfies ResolvedRuntimeAsset;
        } finally {
          await content.handle?.close();
        }
      }),
    );
    this.requireUnchangedProject(lifecycleVersion, projectId);
    current.forEach((snapshot) =>
      this.requireCurrentSnapshot(snapshot.id, snapshot),
    );
    for (const item of resolved) {
      this.update(item.snapshot.id, {}, {
        contentStatus: item.snapshot.contentStatus,
      });
      this.synchronizeObservedUpdatedTime(
        item.snapshot.id,
        item.observedUpdatedTime,
        'refreshAll',
      );
    }
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

    const context = this.createResolveContext(projectId);
    const contentRef = await this.workspaceManager.classifyLocalFile(
      context.projectWorkspace,
      newPath,
    );
    const resolved = await this.resolverRegistry.resolve(
      contentRef,
      context,
    );

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);

      if (resolved.contentStatus.availability !== 'available') {
        throw new AppError('ASSET_UNAVAILABLE');
      }

      if (
        resolved.contentRef.kind !== LOCAL_FILE_CONTENT_KIND ||
        !resolved.location
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const currentPath = await this.workspaceManager.resolveLocalFile(
        context.projectWorkspace,
        current.contentRef,
      );

      if (
        (resolved.contentRef.base !== current.contentRef.base ||
          resolved.contentRef.path !== current.contentRef.path) &&
        !(await this.dependencies.isRelinkMediaCompatible(
          current.mediaType,
          currentPath,
          resolved.location.absolutePath,
        ))
      ) {
        throw new AppError('ASSET_MEDIA_TYPE_MISMATCH');
      }

      this.requireUnchangedProject(lifecycleVersion, projectId);
      this.requireCurrentSnapshot(assetId, current);
      return this.update(
        assetId,
        isSameContentRef(resolved.contentRef, current.contentRef)
          ? {}
          : { contentRef: resolved.contentRef },
        { contentStatus: resolved.contentStatus },
      );
    } finally {
      await resolved.handle?.close();
    }
  }

  async resolveContent(assetId: string): Promise<ResolvedAssetContent> {
    const projectId = this.requireActiveProjectId();
    const lifecycleVersion = this.lifecycleVersion;
    const asset = this.find(assetId);
    const resolved = await this.resolverRegistry.resolve(
      asset.contentRef,
      this.createResolveContext(projectId),
    );

    try {
      this.requireUnchangedProject(lifecycleVersion, projectId);
      this.requireCurrentSnapshot(assetId, asset);
      this.synchronizeObservedUpdatedTime(
        assetId,
        resolved.observedUpdatedTime,
        'resolveContent',
      );

      if (!resolved.handle?.writeBytes) {
        return resolved;
      }

      return {
        ...resolved,
        handle: createTrackedContentHandle(resolved.handle, {
          onDidWrite: () => {
            this.update(assetId, {
              updatedTime: { mode: 'now' },
            });
          },
          onTrackingError: (error) => {
            console.warn('同步 Asset 内容更新时间失败', {
              assetId,
              error,
            });
          },
        }),
      };
    } catch (error) {
      await resolved.handle?.close();
      throw error;
    }
  }

  async revealInFolder(assetId: string): Promise<void> {
    const resolved = await this.resolveContent(assetId);

    try {
      if (
        resolved.contentStatus.availability !== 'available' ||
        !resolved.location
      ) {
        throw new AppError('ASSET_UNAVAILABLE');
      }

      this.workspaceManager.revealFile(resolved.location.absolutePath);
    } finally {
      await resolved.handle?.close();
    }
  }

  subscribe(listener: AssetChangedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async resolveRuntimeSnapshot(
    asset: Asset,
    context: ContentResolveContext,
  ): Promise<ResolvedRuntimeAsset> {
    const resolved = await this.resolverRegistry.resolve(
      asset.contentRef,
      context,
    );

    try {
      return {
        snapshot: createSnapshot(asset, resolved),
        observedUpdatedTime: resolved.observedUpdatedTime,
      };
    } finally {
      await resolved.handle?.close();
    }
  }

  private requireActiveProjectId(): string {
    const projectId = this.activeProjectId;

    if (!projectId) {
      throw new AppError('SERVICE_NOT_READY');
    }

    return projectId;
  }

  private requireExpectedProject(projectId: string): void {
    if (this.requireActiveProjectId() !== projectId) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }
  }

  private createResolveContext(projectId: string): ContentResolveContext {
    const project = this.projectLookup.get(projectId);

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    return {
      projectId,
      projectWorkspace: project.workspacePath,
    };
  }

  private find(assetId: string): AssetSnapshot {
    const snapshot = this.runtimeMap.get(assetId);

    if (!snapshot) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    return snapshot;
  }

  private findClone(assetId: string): AssetSnapshot {
    return cloneAssetSnapshot(this.find(assetId));
  }

  private synchronizeObservedUpdatedTime(
    assetId: string,
    observedUpdatedTime: number | undefined,
    operation: string,
  ): void {
    if (observedUpdatedTime === undefined) {
      return;
    }

    try {
      this.update(assetId, {
        updatedTime: {
          mode: 'observed',
          observedTime: observedUpdatedTime,
        },
      });
    } catch (error) {
      console.warn('同步 Asset 文件修改时间失败', {
        assetId,
        operation,
        error,
      });
    }
  }

  private publishChanged(snapshot: AssetSnapshot): void {
    const event: AssetChangedEvent = Object.freeze({
      projectId: snapshot.projectId,
      asset: cloneAssetSnapshot(snapshot),
    });

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('发布 Asset 更新事件失败', error);
      }
    }
  }

  private requireCurrentSnapshot(
    assetId: string,
    expected: AssetSnapshot,
  ): void {
    if (this.runtimeMap.get(assetId) !== expected) {
      throw new AppError('OPERATION_SUPERSEDED');
    }
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
}
