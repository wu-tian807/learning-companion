import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import { createAssetSnapshot } from '../assets/asset';
import type { AssetServiceApi } from '../assets/asset-service';
import {
  createAbsoluteLocalFileContentRef,
  createAssetContentStatus,
} from '../content/content-ref';
import { AppError } from '../errors/app-error';
import { registerAssetHandlers, removeAssetHandlers } from './assets';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

type RegisteredIpcHandler = (event: unknown, request?: unknown) => unknown;
type IpcHandler = (event: unknown, request?: unknown) => Promise<unknown>;

function findHandler(channel: string): IpcHandler {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );

  if (!registration) {
    throw new Error(`找不到 ${channel} handler`);
  }

  const handler = registration[1] as RegisteredIpcHandler;

  return async (event, request) => {
    const result = await handler(event, request);

    if (!isIpcResult<unknown>(result)) {
      throw new Error('IPC 测试响应无效');
    }

    if (!result.ok) {
      throw result.error;
    }

    return result.data;
  };
}

function createAsset(
  id = 'asset',
  path = '/tmp/notes.md',
): AssetSnapshot {
  return {
    ...createAssetSnapshot({
      id,
      projectId: 'project',
      name: '学习笔记',
      mediaType: 'text/markdown',
      creationKind: 'imported',
      contentRef: createAbsoluteLocalFileContentRef(path),
      createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
      updatedTime: Date.parse('2026-07-27T03:00:00.000Z'),
    }),
    contentStatus: createAssetContentStatus(
      'available',
      Date.parse('2026-07-27T02:00:00.000Z'),
    ),
  };
}

function createDependencies() {
  const asset = createAsset();
  const currentAssets = [asset];
  const folderState = {
    projectId: 'project',
    folders: [{ projectId: 'project', path: '课程' }],
    folderPathByAssetId: {},
  } as const;
  const assetService = {
    subscribe: vi.fn(() => () => undefined),
    selectLocalFiles: vi.fn(async () => ['/tmp/a.md', '/tmp/b.pdf']),
    addLocalFile: vi.fn(
      async (_projectId: string, path: string) => {
        if (path.includes('failed')) {
          throw new AppError('ASSET_UNAVAILABLE');
        }

        const created = createAsset(path, path);
        currentAssets.push(created);
        return created;
      },
    ),
    update: vi.fn(() => asset),
    relinkLocalFile: vi.fn(async () => asset),
    delete: vi.fn(),
    refresh: vi.fn(async () => asset),
    refreshAll: vi.fn(async () => [asset]),
    revealInFolder: vi.fn(async () => undefined),
    getActiveProjectId: vi.fn(() => 'project'),
    list: vi.fn(() => [...currentAssets]),
    listAssetFolders: vi.fn(() => folderState),
    createAssetFolder: vi.fn(() => folderState),
    updateAssetFolder: vi.fn(() => folderState),
    moveAssetsToFolder: vi.fn(() => folderState),
    deleteAssetFolder: vi.fn(async () => ({
      deletedAssetIds: ['asset'],
      failed: [],
      assets: [],
      folderState,
    })),
  } as unknown as AssetServiceApi;

  return { assetService };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Asset IPC handlers', () => {
  it('broadcasts Asset changes and removes its subscription', () => {
    const { assetService } = createDependencies();
    const broadcast = vi.fn();
    const unsubscribe = vi.fn();
    let listener:
      | Parameters<AssetServiceApi['subscribe']>[0]
      | undefined;
    vi.mocked(assetService.subscribe).mockImplementation(
      (nextListener) => {
        listener = nextListener;
        return unsubscribe;
      },
    );
    registerAssetHandlers(assetService, { broadcast });
    const event = {
      projectId: 'project',
      asset: createAsset(),
    };

    listener?.(event);

    expect(broadcast).toHaveBeenCalledWith(
      IPC_CHANNELS.assetChanged,
      event,
    );
    removeAssetHandlers();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('selects files for the Project captured by the request', async () => {
    const { assetService } = createDependencies();
    registerAssetHandlers(assetService);

    await expect(
      findHandler(IPC_CHANNELS.selectLocalAssetFiles)(
        {},
        { projectId: 'project' },
      ),
    ).resolves.toEqual(['/tmp/a.md', '/tmp/b.pdf']);
    expect(assetService.selectLocalFiles).toHaveBeenCalledWith('project');
  });

  it('keeps successful files when a batch addition partially fails', async () => {
    const { assetService } = createDependencies();
    registerAssetHandlers(assetService);

    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)(
        {},
        {
          projectId: 'project',
          paths: ['/tmp/a.md', '/tmp/failed.md', '/tmp/b.md'],
          mode: 'copy',
        },
      ),
    ).resolves.toMatchObject({
      added: [{ id: '/tmp/a.md' }, { id: '/tmp/b.md' }],
      failed: [{ path: '/tmp/failed.md' }],
      assets: [
        { id: 'asset' },
        { id: '/tmp/a.md' },
        { id: '/tmp/b.md' },
      ],
    });
    expect(assetService.addLocalFile).toHaveBeenNthCalledWith(
      1,
      'project',
      '/tmp/a.md',
      'copy',
      undefined,
    );
  });

  it('forwards the external link mode to every Asset addition', async () => {
    const { assetService } = createDependencies();
    registerAssetHandlers(assetService);

    await findHandler(IPC_CHANNELS.addLocalAssets)(
      {},
      {
        projectId: 'project',
        paths: ['/tmp/a.md', '/tmp/b.md'],
        mode: 'link',
      },
    );

    expect(assetService.addLocalFile).toHaveBeenNthCalledWith(
      1,
      'project',
      '/tmp/a.md',
      'link',
      undefined,
    );
    expect(assetService.addLocalFile).toHaveBeenNthCalledWith(
      2,
      'project',
      '/tmp/b.md',
      'link',
      undefined,
    );
  });

  it('stores imports in the requested logical folder', async () => {
    const { assetService } = createDependencies();
    registerAssetHandlers(assetService);

    await findHandler(IPC_CHANNELS.addLocalAssets)(
      {},
      {
        projectId: 'project',
        paths: ['/tmp/a.md'],
        mode: 'copy',
        folderPath: '课程',
      },
    );

    expect(assetService.addLocalFile).toHaveBeenCalledWith(
      'project',
      '/tmp/a.md',
      'copy',
      '课程',
    );
  });

  it('stops a batch when its Project context changes', async () => {
    const { assetService } = createDependencies();
    vi.mocked(assetService.addLocalFile).mockRejectedValueOnce(
      new AppError('PROJECT_CONTEXT_CHANGED'),
    );
    registerAssetHandlers(assetService);

    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)(
        {},
        {
          projectId: 'project',
          paths: ['/tmp/a.md', '/tmp/b.md'],
        },
      ),
    ).rejects.toMatchObject({
      code: 'PROJECT_CONTEXT_CHANGED',
      kind: 'cancelled',
    });
  });

  it('rejects a batch targeting a Project other than the active one', async () => {
    const { assetService } = createDependencies();
    registerAssetHandlers(assetService);

    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)(
        {},
        {
          projectId: 'another-project',
          paths: ['/tmp/a.md'],
        },
      ),
    ).rejects.toMatchObject({
      code: 'PROJECT_CONTEXT_CHANGED',
      kind: 'cancelled',
    });
    expect(assetService.addLocalFile).not.toHaveBeenCalled();
  });

  it('forwards Asset mutations to the active Project services', async () => {
    const { assetService } = createDependencies();
    registerAssetHandlers(assetService);

    await findHandler(IPC_CHANNELS.renameAsset)(
      {},
      { assetId: 'asset', name: '新标题' },
    );
    await findHandler(IPC_CHANNELS.relinkAsset)(
      {},
      { assetId: 'asset', path: '/tmp/new.md' },
    );
    await findHandler(IPC_CHANNELS.deleteAssets)(
      {},
      { projectId: 'project', assetIds: ['asset'] },
    );
    await findHandler(IPC_CHANNELS.refreshAsset)({}, { assetId: 'asset' });
    await findHandler(IPC_CHANNELS.refreshAllAssets)(
      {},
      { projectId: 'project' },
    );
    await findHandler(IPC_CHANNELS.revealAssetInFolder)(
      {},
      { assetId: 'asset' },
    );

    expect(assetService.update).toHaveBeenCalledWith('asset', {
      name: '新标题',
    });
    expect(assetService.relinkLocalFile).toHaveBeenCalledWith(
      'asset',
      '/tmp/new.md',
    );
    expect(assetService.delete).toHaveBeenCalledWith('asset');
    expect(assetService.refresh).toHaveBeenCalledWith('asset');
    expect(assetService.refreshAll).toHaveBeenCalledOnce();
    expect(assetService.revealInFolder).toHaveBeenCalledWith('asset');
  });

  it('returns partial success details from a batch deletion', async () => {
    const { assetService } = createDependencies();
    vi.mocked(assetService.delete).mockImplementation(
      async (assetId: string) => {
        if (assetId === 'failed') {
          throw new AppError('ASSET_UNAVAILABLE');
        }
      },
    );
    registerAssetHandlers(assetService);

    await expect(
      findHandler(IPC_CHANNELS.deleteAssets)(
        {},
        {
          projectId: 'project',
          assetIds: ['deleted', 'failed'],
        },
      ),
    ).resolves.toMatchObject({
      deletedAssetIds: ['deleted'],
      failed: [
        {
          assetId: 'failed',
          message: '所选文件当前不可用，请检查文件是否存在以及访问权限。',
        },
      ],
    });
    expect(assetService.delete).toHaveBeenNthCalledWith(1, 'deleted');
    expect(assetService.delete).toHaveBeenNthCalledWith(2, 'failed');
    expect(assetService.list).toHaveBeenCalledOnce();
  });

  it('forwards folder navigation and mutation requests', async () => {
    const { assetService } = createDependencies();
    registerAssetHandlers(assetService);

    await findHandler(IPC_CHANNELS.listAssetFolders)(
      {},
      { projectId: 'project' },
    );
    await findHandler(IPC_CHANNELS.createAssetFolder)(
      {},
      { projectId: 'project', path: '课程' },
    );
    await findHandler(IPC_CHANNELS.updateAssetFolder)(
      {},
      { projectId: 'project', path: '课程', nextPath: '归档/课程' },
    );
    await findHandler(IPC_CHANNELS.moveAssetsToFolder)(
      {},
      { projectId: 'project', assetIds: ['asset'], folderPath: '课程' },
    );

    expect(assetService.listAssetFolders).toHaveBeenCalledWith('project');
    expect(assetService.createAssetFolder).toHaveBeenCalledWith(
      'project',
      '课程',
    );
    expect(assetService.updateAssetFolder).toHaveBeenCalledWith(
      'project',
      '课程',
      '归档/课程',
    );
    expect(assetService.moveAssetsToFolder).toHaveBeenCalledWith(
      'project',
      ['asset'],
      '课程',
    );
  });

  it('serializes partial folder deletion failures without removing the folder', async () => {
    const { assetService } = createDependencies();
    vi.mocked(assetService.deleteAssetFolder).mockResolvedValueOnce({
      deletedAssetIds: [],
      failed: [
        { assetId: 'asset', error: new AppError('ASSET_UNAVAILABLE') },
      ],
      assets: [createAsset()],
      folderState: {
        projectId: 'project',
        folders: [{ projectId: 'project', path: '课程' }],
        folderPathByAssetId: { asset: '课程' },
      },
    });
    registerAssetHandlers(assetService);

    await expect(
      findHandler(IPC_CHANNELS.deleteAssetFolder)(
        {},
        { projectId: 'project', path: '课程' },
      ),
    ).resolves.toMatchObject({
      deletedAssetIds: [],
      failed: [
        {
          assetId: 'asset',
          message: '所选文件当前不可用，请检查文件是否存在以及访问权限。',
        },
      ],
      folderState: { folders: [{ path: '课程' }] },
    });
  });

  it('stops a batch deletion when its Project changes', async () => {
    const { assetService } = createDependencies();
    vi.mocked(assetService.delete).mockRejectedValueOnce(
      new AppError('PROJECT_CONTEXT_CHANGED'),
    );
    registerAssetHandlers(assetService);

    await expect(
      findHandler(IPC_CHANNELS.deleteAssets)(
        {},
        {
          projectId: 'project',
          assetIds: ['asset'],
        },
      ),
    ).rejects.toMatchObject({
      code: 'PROJECT_CONTEXT_CHANGED',
      kind: 'cancelled',
    });
    expect(assetService.list).not.toHaveBeenCalled();
  });

  it('rejects malformed requests before reaching the domain layer', async () => {
    const { assetService } = createDependencies();
    registerAssetHandlers(assetService);

    await expect(
      findHandler(IPC_CHANNELS.selectLocalAssetFiles)({}, {}),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.createAssetFolder)(
        {},
        { projectId: 'project', path: 'bad\\name' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.moveAssetsToFolder)(
        {},
        { projectId: 'project', assetIds: [], folderPath: null },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)(
        {},
        { projectId: 'project', paths: [] },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.deleteAssets)(
        {},
        { projectId: 'project', assetIds: [] },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
  });

  it('removes every Asset handler', () => {
    removeAssetHandlers();

    for (const channel of [
      IPC_CHANNELS.selectLocalAssetFiles,
      IPC_CHANNELS.addLocalAssets,
      IPC_CHANNELS.renameAsset,
      IPC_CHANNELS.relinkAsset,
      IPC_CHANNELS.deleteAssets,
      IPC_CHANNELS.refreshAsset,
      IPC_CHANNELS.refreshAllAssets,
      IPC_CHANNELS.revealAssetInFolder,
      IPC_CHANNELS.listAssetFolders,
      IPC_CHANNELS.createAssetFolder,
      IPC_CHANNELS.updateAssetFolder,
      IPC_CHANNELS.deleteAssetFolder,
      IPC_CHANNELS.moveAssetsToFolder,
    ]) {
      expect(electronMocks.removeHandler).toHaveBeenCalledWith(channel);
    }
  });
});
