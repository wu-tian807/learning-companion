import { describe, expect, it, vi } from 'vitest';

import type { ContentCapability } from '../../shared/workbench/manifest';
import type { ContentHandle } from '../content/content-handle';
import {
  createAssetContentStatus,
  createLocalFileContentRef,
  type AssetContentAvailability,
} from '../content/content-ref';
import {
  ContentResolverRegistry,
  type ContentResolver,
} from '../content/content-resolver-registry';
import { cloneAsset, createAssetSnapshot, type Asset } from './asset';
import type { AssetDatabaseApi } from './asset-database';
import { AssetService } from './asset-service';

function createAsset(
  id = 'asset',
  path = '/tmp/notes.md',
  mediaType = 'text/markdown',
): Asset {
  return createAssetSnapshot({
    id,
    projectId: 'project',
    name: '学习笔记',
    mediaType,
    contentRef: createLocalFileContentRef(path),
    createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
    lastUsedTime: Date.parse('2026-07-27T01:00:00.000Z'),
  });
}

function createDatabase(initialAssets: readonly Asset[] = [createAsset()]) {
  let activeProjectId: string | undefined = 'project';
  const assetMap = new Map(
    initialAssets.map((asset) => [asset.id, cloneAsset(asset)]),
  );
  const database = {
    loadFromProject: vi.fn(async (projectId: string) => {
      activeProjectId = projectId;
      return [...assetMap.values()].map(cloneAsset);
    }),
    countByProjectIds: vi.fn(() => new Map([['project', assetMap.size]])),
    unloadProject: vi.fn(() => {
      activeProjectId = undefined;
    }),
    getActiveProjectId: vi.fn(() => activeProjectId),
    list: vi.fn(() => [...assetMap.values()].map(cloneAsset)),
    get: vi.fn((assetId: string) => assetMap.get(assetId)),
    add: vi.fn((input) => {
      const asset = createAssetSnapshot({
        id: 'created',
        projectId: activeProjectId ?? 'project',
        ...input,
        createdTime: Date.parse('2026-07-27T02:00:00.000Z'),
        lastUsedTime: Date.parse('2026-07-27T02:00:00.000Z'),
      });
      assetMap.set(asset.id, asset);
      return cloneAsset(asset);
    }),
    update: vi.fn((assetId: string, changes) => {
      const current = assetMap.get(assetId)!;
      const next = createAssetSnapshot({ ...current, ...changes });
      assetMap.set(assetId, next);
      return cloneAsset(next);
    }),
    updateContentRef: vi.fn((assetId: string, contentRef) => {
      const current = assetMap.get(assetId)!;
      const next = createAssetSnapshot({ ...current, contentRef });
      assetMap.set(assetId, next);
      return cloneAsset(next);
    }),
    delete: vi.fn((assetId: string) => {
      assetMap.delete(assetId);
    }),
  } as unknown as AssetDatabaseApi;

  return database;
}

function createResolver(
  availability: () => AssetContentAvailability = () => 'available',
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
        handle,
      };
    }),
  };
  const registry = new ContentResolverRegistry();
  registry.register(resolver);

  return { handles, registry, resolver };
}

describe('AssetService', () => {
  it('loads runtime status while keeping Asset pure data', async () => {
    const database = createDatabase();
    const { handles, registry } = createResolver(() => 'missing');
    const service = new AssetService(database, registry);

    const loaded = await service.loadFromProject('project');

    expect(loaded[0]).toMatchObject({
      id: 'asset',
      contentRef: { kind: 'local-file', path: '/tmp/notes.md' },
      contentStatus: { availability: 'missing' },
    });
    expect(handles).toHaveLength(0);
  });

  it('imports an available local file with derived metadata', async () => {
    const database = createDatabase([]);
    const { handles, registry } = createResolver();
    const service = new AssetService(database, registry, {
      detectMediaType: vi.fn(async () => 'text/plain'),
      createDefaultName: vi.fn(() => '资料'),
    });

    const created = await service.addLocalFile(
      'project',
      '/tmp/资料.txt',
    );

    expect(database.add).toHaveBeenCalledWith({
      name: '资料',
      mediaType: 'text/plain',
      contentRef: createLocalFileContentRef('/tmp/资料.txt'),
    });
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
    const service = new AssetService(database, registry);
    await service.loadFromProject('project');
    availability = 'missing';

    const refreshed = await service.refresh('asset');

    expect(refreshed.contentStatus.availability).toBe('missing');
    expect(database.update).not.toHaveBeenCalled();
    expect(database.updateContentRef).not.toHaveBeenCalled();
  });

  it('relinks only compatible available local files', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const isRelinkMediaCompatible = vi.fn(async () => true);
    const service = new AssetService(database, registry, {
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
    expect(database.updateContentRef).toHaveBeenCalledWith(
      'asset',
      createLocalFileContentRef('/tmp/new-notes.md'),
    );
    expect(relinked.contentRef).toEqual(
      createLocalFileContentRef('/tmp/new-notes.md'),
    );
  });

  it('does not persist a media-incompatible relink', async () => {
    const database = createDatabase();
    const { registry } = createResolver();
    const service = new AssetService(database, registry, {
      isRelinkMediaCompatible: vi.fn(async () => false),
    });
    await service.loadFromProject('project');

    await expect(
      service.relinkLocalFile('asset', '/tmp/book.pdf'),
    ).rejects.toThrow('ASSET_MEDIA_TYPE_MISMATCH');
    expect(database.updateContentRef).not.toHaveBeenCalled();
  });

  it('hands an open ContentHandle to the Workbench caller', async () => {
    const database = createDatabase();
    const { handles, registry } = createResolver();
    const service = new AssetService(database, registry);
    await service.loadFromProject('project');

    const resolved = await service.resolveContent('asset');

    expect(resolved.handle).toBeDefined();
    expect(handles.at(-1)?.close).not.toHaveBeenCalled();

    await (resolved.handle as ContentHandle).close();
    expect(handles.at(-1)?.close).toHaveBeenCalledOnce();
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
    const service = new AssetService(database, registry, {
      detectMediaType: vi.fn(async () => 'text/plain'),
    });

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
    const service = new AssetService(database, registry);

    await expect(
      service.addLocalFile('another-project', '/tmp/notes.txt'),
    ).rejects.toThrow('PROJECT_CONTEXT_CHANGED');
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(database.add).not.toHaveBeenCalled();
  });
});
