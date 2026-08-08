import { describe, expect, it, vi } from 'vitest';

import type { ContentCapability } from '../../shared/workbench/manifest';
import { MIND_MAP_ASSET_MEDIA_TYPE } from '../../shared/asset-media-types';
import type { ContentHandle } from '../content/content-handle';
import {
  createAssetContentStatus,
  createAbsoluteLocalFileContentRef,
  createProjectWorkspaceContentRef,
  type AssetContentAvailability,
} from '../content/content-ref';
import {
  ContentResolverRegistry,
  type ContentResolver,
} from '../content/content-resolver-registry';
import type { ProjectLookup } from '../projects/project-database';
import type { ProjectWorkspaceManagerApi } from '../projects/project-workspace-manager';
import { cloneAsset, createAssetSnapshot, type Asset } from './asset';
import type { AssetDatabaseApi } from './asset-database';
import {
  AssetService,
  type AssetServiceDependencies,
} from './asset-service';

const SERVICE_NOW = Date.parse('2026-07-27T04:00:00.000Z');

function createAsset(
  id = 'asset',
  path = '/tmp/notes.md',
  mediaType = 'text/markdown',
  projectId = 'project',
): Asset {
  return createAssetSnapshot({
    id,
    projectId,
    name: '学习笔记',
    mediaType,
    creationKind: 'imported',
    contentRef: createAbsoluteLocalFileContentRef(path),
    createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
    updatedTime: Date.parse('2026-07-27T01:00:00.000Z'),
  });
}

function createDatabase(initialAssets: readonly Asset[] = [createAsset()]) {
  const assetMap = new Map(
    initialAssets.map((asset) => [asset.id, cloneAsset(asset)]),
  );
  const database = {
    listByProject: vi.fn((projectId: string) =>
      [...assetMap.values()]
        .filter((asset) => asset.projectId === projectId)
        .map(cloneAsset),
    ),
    countByProjectIds: vi.fn(() => new Map([['project', assetMap.size]])),
    add: vi.fn((projectId: string, input) => {
      const asset = createAssetSnapshot({
        id: 'created',
        projectId,
        ...input,
        createdTime: Date.parse('2026-07-27T02:00:00.000Z'),
        updatedTime: Date.parse('2026-07-27T02:00:00.000Z'),
      });
      assetMap.set(asset.id, asset);
      return cloneAsset(asset);
    }),
    update: vi.fn((_projectId: string, assetId: string, changes) => {
      const current = assetMap.get(assetId)!;
      const next = createAssetSnapshot({ ...current, ...changes });
      assetMap.set(assetId, next);
      return cloneAsset(next);
    }),
    delete: vi.fn((_projectId: string, assetId: string) => {
      assetMap.delete(assetId);
    }),
  } as unknown as AssetDatabaseApi;

  return database;
}

function createResolver(
  availability: () => AssetContentAvailability = () => 'available',
  observedUpdatedTime: () => number | undefined = () => undefined,
) {
  const handles: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const resolver: ContentResolver = {
    kind: 'local-file',
    resolve: vi.fn(async (ref) => {
      const currentAvailability = availability();
      const handle =
        currentAvailability === 'available'
          ? {
              capabilities: new Set<ContentCapability>(),
              close: vi.fn(async () => undefined),
            }
          : undefined;

      if (handle) {
        handles.push(handle);
      }

      return {
        contentRef: ref,
        contentStatus: createAssetContentStatus(
          currentAvailability,
          Date.parse('2026-07-27T03:00:00.000Z'),
        ),
        observedUpdatedTime: observedUpdatedTime(),
        location: {
          kind: 'local-file' as const,
          absolutePath: ref.path,
        },
        handle,
      };
    }),
  };
  const registry = new ContentResolverRegistry();
  registry.register(resolver);

  return { handles, registry, resolver };
}

function createService(
  database: AssetDatabaseApi,
  registry: ContentResolverRegistry,
  dependencies: Partial<AssetServiceDependencies> = {},
  workspaceManagerOverrides: Partial<ProjectWorkspaceManagerApi> = {},
): AssetService {
  const projectLookup = {
    get: (projectId: string) =>
      projectId === 'project' || projectId === 'project-two'
        ? {
            id: projectId,
            name: 'Project',
            icon: '📘',
            createdTime: 0,
            pinned: false,
            workspacePath: `/tmp/${projectId}`,
          }
        : undefined,
  } as ProjectLookup;
  const workspaceManager = {
    validateWorkspace: async () => undefined,
    copyImportedFile: async (_workspacePath: string, path: string) => ({
      contentRef: createAbsoluteLocalFileContentRef(path),
    }),
    classifyLocalFile: async (_workspacePath: string, path: string) =>
      createAbsoluteLocalFileContentRef(path),
    resolveLocalFile: async (_workspacePath: string, ref: Asset['contentRef']) =>
      ref.path,
    removeManagedAssetFile: async () => false,
    createGeneratedFile: async (
      workspacePath: string,
      fileName: string,
    ) => ({
      contentRef: createProjectWorkspaceContentRef(
        `assets/generated/${fileName}`,
      ),
      absolutePath: `${workspacePath}/assets/generated/${fileName}`,
      created: true,
    }),
    selectAssetFiles: async () => [],
    revealFile: vi.fn(),
    ...workspaceManagerOverrides,
  } as unknown as ProjectWorkspaceManagerApi;

  return new AssetService(
    database,
    registry,
    projectLookup,
    workspaceManager,
    {
      now: () => SERVICE_NOW,
      ...dependencies,
    },
  );
}

describe('AssetService', () => {
  it('loads runtime status while keeping Asset pure data', async () => {
    const database = createDatabase();
    const { handles, registry } = createResolver(() => 'missing');
    const service = createService(database, registry);

    const loaded = await service.loadFromProject('project');

    expect(loaded[0]).toMatchObject({
      id: 'asset',
      contentRef: { kind: 'local-file', path: '/tmp/notes.md' },
      contentStatus: { availability: 'missing' },
    });
    expect(handles).toHaveLength(0);
  });

  it('synchronizes an observed file modification time while loading', async () => {
    const database = createDatabase();
    const observedUpdatedTime = Date.parse(
      '2026-07-27T03:00:00.000Z',
    );
    const { registry } = createResolver(
      () => 'available',
      () => observedUpdatedTime,
    );
    const service = createService(database, registry);

    const loaded = await service.loadFromProject('project');

    expect(database.update).toHaveBeenCalledWith('project', 'asset', {
      updatedTime: observedUpdatedTime,
    });
    expect(loaded[0]?.updatedTime).toBe(observedUpdatedTime);
  });

  it('keeps Project loading successful when observed time synchronization fails', async () => {
    const database = createDatabase();
    const { registry } = createResolver(
      () => 'available',
      () => Date.parse('2026-07-27T03:00:00.000Z'),
    );
    vi.mocked(database.update).mockImplementationOnce(() => {
      throw new Error('metadata failed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createService(database, registry);

    const loaded = await service.loadFromProject('project');

    expect(loaded[0]?.updatedTime).toBe(
      Date.parse('2026-07-27T01:00:00.000Z'),
    );
    expect(warn).toHaveBeenCalledWith(
      '同步 Asset 文件修改时间失败',
      expect.objectContaining({
        assetId: 'asset',
        operation: 'loadFromProject',
      }),
    );
    warn.mockRestore();
  });

  it('stays inactive when runtime resolution fails during loading', async () => {
    const database = createDatabase();
    const registry = new ContentResolverRegistry();
    registry.register({
      kind: 'local-file',
      resolve: async () => {
        throw new Error('resolve failed');
      },
    });
    const service = createService(database, registry);

    await expect(service.loadFromProject('project')).rejects.toThrow(
      'resolve failed',
    );
    expect(service.getActiveProjectId()).toBeUndefined();
    expect(() => service.list()).toThrow('SERVICE_NOT_READY');
  });

  it('does not let a superseded load replace the newer Project', async () => {
    const database = createDatabase([
      createAsset(
        'asset-one',
        '/tmp/one.md',
        'text/markdown',
        'project',
      ),
      createAsset(
        'asset-two',
        '/tmp/two.md',
        'text/markdown',
        'project-two',
      ),
    ]);
    let releaseFirstResolve: (() => void) | undefined;
    const registry = new ContentResolverRegistry();
    registry.register({
      kind: 'local-file',
      resolve: async (ref) => {
        if (ref.path === '/tmp/one.md') {
          await new Promise<void>((resolve) => {
            releaseFirstResolve = resolve;
          });
        }

        return {
          contentRef: ref,
          contentStatus: createAssetContentStatus(
            'missing',
            Date.parse('2026-07-27T03:00:00.000Z'),
          ),
        };
      },
    });
    const service = createService(database, registry);

    const firstLoad = service.loadFromProject('project');
    await vi.waitFor(() =>
      expect(releaseFirstResolve).toBeTypeOf('function'),
    );
    const secondLoad = await service.loadFromProject('project-two');
    releaseFirstResolve?.();

    await expect(firstLoad).rejects.toThrow('OPERATION_SUPERSEDED');
    expect(secondLoad.map(({ id }) => id)).toEqual(['asset-two']);
    expect(service.getActiveProjectId()).toBe('project-two');
    expect(service.list().map(({ id }) => id)).toEqual(['asset-two']);
  });

  it('imports an available local file with derived metadata', async () => {
    const database = createDatabase([]);
    const { handles, registry } = createResolver();
    const service = createService(database, registry, {
      detectMediaType: vi.fn(async () => 'text/plain'),
      createDefaultName: vi.fn(() => '资料'),
    });
    await service.loadFromProject('project');

    const created = await service.addLocalFile(
      'project',
      '/tmp/资料.txt',
    );

    expect(database.add).toHaveBeenCalledWith(
      'project',
      {
        name: '资料',
        mediaType: 'text/plain',
        creationKind: 'imported',
        contentRef: createAbsoluteLocalFileContentRef('/tmp/资料.txt'),
      },
    );
    expect(created).toMatchObject({
      id: 'created',
      name: '资料',
      mediaType: 'text/plain',
      contentStatus: { availability: 'available' },
    });
    expect(handles[0]?.close).toHaveBeenCalledOnce();
  });

  it('refreshes runtime status without writing Asset data', async () => {
    let availability: AssetContentAvailability = 'available';
    const database = createDatabase();
    const { registry } = createResolver(() => availability);
    const service = createService(database, registry);
    await service.loadFromProject('project');
    availability = 'missing';

    const refreshed = await service.refresh('asset');

    expect(refreshed.contentStatus.availability).toBe('missing');
    expect(database.update).not.toHaveBeenCalled();
  });

  it('updates direct Asset changes and their time through one database write', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const service = createService(database, registry);
    await service.loadFromProject('project');

    const updated = service.update('asset', { name: '新标题' });

    expect(database.update).toHaveBeenCalledWith('project', 'asset', {
      name: '新标题',
      updatedTime: SERVICE_NOW,
    });
    expect(updated).toMatchObject({
      name: '新标题',
      updatedTime: SERVICE_NOW,
    });
  });

  it('publishes committed snapshots and supports removing listeners', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const service = createService(database, registry);
    await service.loadFromProject('project');
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    service.update('asset', { name: '第一次更新' });
    unsubscribe();
    service.update('asset', { name: '第二次更新' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      projectId: 'project',
      asset: expect.objectContaining({
        id: 'asset',
        name: '第一次更新',
        updatedTime: SERVICE_NOW,
      }),
    });
  });

  it('does not roll back updates when an event listener fails', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const service = createService(database, registry);
    await service.loadFromProject('project');
    service.subscribe(() => {
      throw new Error('listener failed');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const updated = service.update('asset', { name: '仍然成功' });

    expect(updated.name).toBe('仍然成功');
    expect(error).toHaveBeenCalledWith(
      '发布 Asset 更新事件失败',
      expect.any(Error),
    );
    error.mockRestore();
  });

  it('skips normalized no-op updates', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const service = createService(database, registry);
    await service.loadFromProject('project');

    const unchanged = service.update('asset', {
      name: ' 学习笔记 ',
      updatedTime: {
        mode: 'observed',
        observedTime: Date.parse('2026-07-26T04:00:00.000Z'),
      },
    });

    expect(database.update).not.toHaveBeenCalled();
    expect(unchanged.updatedTime).toBe(
      Date.parse('2026-07-27T01:00:00.000Z'),
    );
  });

  it('clamps observed future times and never moves updated time backwards', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const service = createService(database, registry);
    await service.loadFromProject('project');

    const updated = service.update('asset', {
      updatedTime: {
        mode: 'observed',
        observedTime: Date.parse('2027-01-01T00:00:00.000Z'),
      },
    });
    const unchanged = service.update('asset', {
      updatedTime: {
        mode: 'observed',
        observedTime: Date.parse('2026-07-27T02:00:00.000Z'),
      },
    });

    expect(updated.updatedTime).toBe(SERVICE_NOW);
    expect(unchanged.updatedTime).toBe(SERVICE_NOW);
    expect(database.update).toHaveBeenCalledOnce();
  });

  it('does not replace the runtime snapshot when persistence fails', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const service = createService(database, registry);
    await service.loadFromProject('project');
    vi.mocked(database.update).mockImplementationOnce(() => {
      throw new Error('write failed');
    });

    expect(() => service.update('asset', { name: '新标题' })).toThrow(
      'write failed',
    );
    expect(service.get('asset')?.name).toBe('学习笔记');
  });

  it('relinks only compatible available local files', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const isRelinkMediaCompatible = vi.fn(async () => true);
    const service = createService(database, registry, {
      isRelinkMediaCompatible,
    });
    await service.loadFromProject('project');

    const relinked = await service.relinkLocalFile(
      'asset',
      '/tmp/new-notes.md',
    );

    expect(isRelinkMediaCompatible).toHaveBeenCalledWith(
      'text/markdown',
      '/tmp/notes.md',
      '/tmp/new-notes.md',
    );
    expect(database.update).toHaveBeenCalledWith(
      'project',
      'asset',
      {
        contentRef: createAbsoluteLocalFileContentRef('/tmp/new-notes.md'),
        updatedTime: SERVICE_NOW,
      },
    );
    expect(relinked.contentRef).toEqual(
      createAbsoluteLocalFileContentRef('/tmp/new-notes.md'),
    );
    expect(relinked.updatedTime).toBe(SERVICE_NOW);
    expect(relinked.contentStatus.checkedTime).toBe(
      Date.parse('2026-07-27T03:00:00.000Z'),
    );
  });

  it('does not persist a media-incompatible relink', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const service = createService(database, registry, {
      isRelinkMediaCompatible: vi.fn(async () => false),
    });
    await service.loadFromProject('project');

    await expect(
      service.relinkLocalFile('asset', '/tmp/book.pdf'),
    ).rejects.toThrow('ASSET_MEDIA_TYPE_MISMATCH');
    expect(database.update).not.toHaveBeenCalled();
  });

  it('hands an open ContentHandle to the Workbench caller', async () => {
    const database = createDatabase();
    const { handles, registry } = createResolver();
    const service = createService(database, registry);
    await service.loadFromProject('project');

    const resolved = await service.resolveContent('asset');

    expect(resolved.handle).toBeDefined();
    expect(handles.at(-1)?.close).not.toHaveBeenCalled();

    await (resolved.handle as ContentHandle).close();
    expect(handles.at(-1)?.close).toHaveBeenCalledOnce();
  });

  it('stages generated files idempotently and removes their managed source', async () => {
    const database = createDatabase([]);
    const { registry } = createResolver();
    const contentRef = createProjectWorkspaceContentRef(
      'assets/generated/task-1.mindmap',
    );
    const createGeneratedFile = vi.fn(async () => ({
      contentRef,
      absolutePath: '/tmp/project/assets/generated/task-1.mindmap',
      created: true,
    }));
    const removeManagedAssetFile = vi.fn(async () => true);
    const service = createService(
      database,
      registry,
      { detectMediaType: vi.fn(async () => MIND_MAP_ASSET_MEDIA_TYPE) },
      { createGeneratedFile, removeManagedAssetFile },
    );
    await service.loadFromProject('project');

    const first = await service.stageGeneratedFile('project', {
      fileName: 'task-1.mindmap',
      name: '课程结构',
      mediaType: MIND_MAP_ASSET_MEDIA_TYPE,
      content: new TextEncoder().encode('{}'),
    });
    const second = await service.stageGeneratedFile('project', {
      fileName: 'task-1.mindmap',
      name: '不会覆盖已有 Asset',
      mediaType: MIND_MAP_ASSET_MEDIA_TYPE,
      content: new TextEncoder().encode('{"changed":true}'),
    });

    expect(first).toMatchObject({ created: true, asset: { id: 'created' } });
    expect(second).toMatchObject({
      created: false,
      asset: { id: 'created', name: '课程结构' },
    });
    expect(database.add).toHaveBeenCalledOnce();
    expect(database.add).toHaveBeenCalledWith('project', {
      name: '课程结构',
      mediaType: MIND_MAP_ASSET_MEDIA_TYPE,
      creationKind: 'generated',
      contentRef,
    });

    await service.delete('created');

    expect(removeManagedAssetFile).toHaveBeenCalledWith(
      '/tmp/project',
      contentRef,
    );
  });

  it('removes the Workspace-owned copy when deleting an imported Asset', async () => {
    const copiedRef = createProjectWorkspaceContentRef(
      'assets/imported/lecture.pdf',
    );
    const copiedAsset = createAssetSnapshot({
      ...createAsset(),
      contentRef: copiedRef,
    });
    const database = createDatabase([copiedAsset]);
    const { registry } = createResolver();
    const removeManagedAssetFile = vi.fn(async () => true);
    const service = createService(database, registry, {}, {
      removeManagedAssetFile,
    });
    await service.loadFromProject('project');

    await service.delete('asset');

    expect(removeManagedAssetFile).toHaveBeenCalledWith(
      '/tmp/project',
      copiedRef,
    );
  });

  it('keeps the Asset record when its managed file cannot be removed', async () => {
    const copiedRef = createProjectWorkspaceContentRef(
      'assets/imported/locked.pdf',
    );
    const copiedAsset = createAssetSnapshot({
      ...createAsset(),
      contentRef: copiedRef,
    });
    const database = createDatabase([copiedAsset]);
    const { registry } = createResolver();
    const service = createService(database, registry, {}, {
      removeManagedAssetFile: vi.fn(async () => {
        throw new Error('file locked');
      }),
    });
    await service.loadFromProject('project');

    await expect(service.delete('asset')).rejects.toThrow('file locked');

    expect(database.delete).not.toHaveBeenCalled();
    expect(service.get('asset')).toBeDefined();
  });

  it('removes all persisted managed files before deleting a Project', async () => {
    const copiedRef = createProjectWorkspaceContentRef(
      'assets/imported/lecture.pdf',
    );
    const database = createDatabase([
      createAssetSnapshot({ ...createAsset('copied'), contentRef: copiedRef }),
      createAsset('linked', '/external/notes.md'),
    ]);
    const { registry } = createResolver();
    const removeManagedAssetFile = vi.fn(async () => true);
    const service = createService(database, registry, {}, {
      removeManagedAssetFile,
    });

    await service.removeManagedFilesByProject('project', '/tmp/project');

    expect(removeManagedAssetFile).toHaveBeenCalledTimes(2);
    expect(removeManagedAssetFile).toHaveBeenNthCalledWith(
      1,
      '/tmp/project',
      copiedRef,
    );
    expect(removeManagedAssetFile).toHaveBeenNthCalledWith(
      2,
      '/tmp/project',
      createAbsoluteLocalFileContentRef('/external/notes.md'),
    );
  });

  it('tracks successful Workbench content writes through AssetService update', async () => {
    const database = createDatabase();
    const writeBytes = vi.fn(async () => ({ revision: 'after' }));
    const close = vi.fn(async () => undefined);
    const registry = new ContentResolverRegistry();
    registry.register({
      kind: 'local-file',
      resolve: async (ref) => ({
        contentRef: ref,
        contentStatus: createAssetContentStatus(
          'available',
          Date.parse('2026-07-27T03:00:00.000Z'),
        ),
        handle: {
          capabilities: new Set<ContentCapability>(['write-bytes']),
          writeBytes,
          close,
        },
      }),
    });
    const service = createService(database, registry);
    await service.loadFromProject('project');
    close.mockClear();

    const resolved = await service.resolveContent('asset');
    await expect(
      resolved.handle?.writeBytes?.({
        content: new Uint8Array([1]),
        expectedRevision: 'before',
      }),
    ).resolves.toEqual({ revision: 'after' });

    expect(database.update).toHaveBeenCalledWith('project', 'asset', {
      updatedTime: SERVICE_NOW,
    });
    expect(service.get('asset')?.updatedTime).toBe(SERVICE_NOW);
    await resolved.handle?.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps content writes successful when their time synchronization fails', async () => {
    const database = createDatabase();
    const writeBytes = vi.fn(async () => ({ revision: 'after' }));
    const registry = new ContentResolverRegistry();
    registry.register({
      kind: 'local-file',
      resolve: async (ref) => ({
        contentRef: ref,
        contentStatus: createAssetContentStatus(
          'available',
          Date.parse('2026-07-27T03:00:00.000Z'),
        ),
        handle: {
          capabilities: new Set<ContentCapability>(['write-bytes']),
          writeBytes,
          close: async () => undefined,
        },
      }),
    });
    const service = createService(database, registry);
    await service.loadFromProject('project');
    vi.mocked(database.update).mockImplementationOnce(() => {
      throw new Error('metadata failed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const resolved = await service.resolveContent('asset');

    await expect(
      resolved.handle?.writeBytes?.({
        content: new Uint8Array([1]),
        expectedRevision: 'before',
      }),
    ).resolves.toEqual({ revision: 'after' });
    expect(warn).toHaveBeenCalledWith(
      '同步 Asset 内容更新时间失败',
      expect.objectContaining({ assetId: 'asset' }),
    );
    warn.mockRestore();
  });

  it('does not let a stale refresh overwrite a newer update', async () => {
    const database = createDatabase();
    let resolveCount = 0;
    let finishRefresh: (() => void) | undefined;
    const registry = new ContentResolverRegistry();
    registry.register({
      kind: 'local-file',
      resolve: async (ref) => {
        resolveCount += 1;
        if (resolveCount === 2) {
          await new Promise<void>((resolve) => {
            finishRefresh = resolve;
          });
        }
        return {
          contentRef: ref,
          contentStatus: createAssetContentStatus(
            'available',
            Date.parse('2026-07-27T03:00:00.000Z') + resolveCount,
          ),
        };
      },
    });
    const service = createService(database, registry);
    await service.loadFromProject('project');

    const refresh = service.refresh('asset');
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf('function'));
    service.update('asset', { name: '并发新标题' });
    finishRefresh?.();

    await expect(refresh).rejects.toThrow('OPERATION_SUPERSEDED');
    expect(service.get('asset')?.name).toBe('并发新标题');
  });

  it('rejects a pending operation after the Project is unloaded', async () => {
    const database = createDatabase([]);
    let finishResolve: (() => void) | undefined;
    const registry = new ContentResolverRegistry();
    registry.register({
      kind: 'local-file',
      resolve: async (ref) => {
        await new Promise<void>((resolve) => {
          finishResolve = resolve;
        });
        return {
          contentRef: ref,
          contentStatus: createAssetContentStatus(
            'available',
            Date.parse('2026-07-27T03:00:00.000Z'),
          ),
          handle: {
            capabilities: new Set<ContentCapability>(),
            close: async () => undefined,
          },
        };
      },
    });
    const service = createService(database, registry, {
      detectMediaType: vi.fn(async () => 'text/plain'),
    });
    await service.loadFromProject('project');

    const addition = service.addLocalFile(
      'project',
      '/tmp/notes.txt',
    );
    await vi.waitFor(() => expect(finishResolve).toBeTypeOf('function'));
    service.unloadProject();
    finishResolve?.();

    await expect(addition).rejects.toThrow('PROJECT_CONTEXT_CHANGED');
    expect(database.add).not.toHaveBeenCalled();
  });

  it('rejects an addition for a Project other than the active Project', async () => {
    const database = createDatabase([]);
    const { registry, resolver } = createResolver();
    const service = createService(database, registry);
    await service.loadFromProject('project');

    await expect(
      service.addLocalFile('another-project', '/tmp/notes.txt'),
    ).rejects.toThrow('PROJECT_CONTEXT_CHANGED');
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(database.add).not.toHaveBeenCalled();
  });

  it('cleans managed Artifacts before deleting an Asset', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const artifactCleanup = {
      removeByAsset: vi.fn(async () => undefined),
      removeByProject: vi.fn(async () => undefined),
    };
    const deletionObserver = {
      onAssetDeleted: vi.fn(),
    };
    const service = createService(database, registry, {
      artifactCleanup,
      deletionObserver,
    });
    await service.loadFromProject('project');

    await service.delete('asset');

    expect(artifactCleanup.removeByAsset).toHaveBeenCalledWith(
      'asset',
      '/tmp/project',
    );
    expect(database.delete).toHaveBeenCalledWith('project', 'asset');
    expect(deletionObserver.onAssetDeleted).toHaveBeenCalledWith(
      'project',
      'asset',
    );
  });
});
