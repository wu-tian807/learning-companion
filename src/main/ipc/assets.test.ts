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
      contentRef: createAbsoluteLocalFileContentRef(path),
      createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
      lastUsedTime: Date.parse('2026-07-27T03:00:00.000Z'),
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
  const assetService = {
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
  } as unknown as AssetServiceApi;

  return { assetService };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Asset IPC handlers', () => {
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
    );
    expect(assetService.addLocalFile).toHaveBeenNthCalledWith(
      2,
      'project',
      '/tmp/b.md',
      'link',
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
    await findHandler(IPC_CHANNELS.deleteAsset)({}, { assetId: 'asset' });
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

  it('rejects malformed requests before reaching the domain layer', async () => {
    const { assetService } = createDependencies();
    registerAssetHandlers(assetService);

    await expect(
      findHandler(IPC_CHANNELS.selectLocalAssetFiles)({}, {}),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)(
        {},
        { projectId: 'project', paths: [] },
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
      IPC_CHANNELS.deleteAsset,
      IPC_CHANNELS.refreshAsset,
      IPC_CHANNELS.refreshAllAssets,
      IPC_CHANNELS.revealAssetInFolder,
    ]) {
      expect(electronMocks.removeHandler).toHaveBeenCalledWith(channel);
    }
  });
});
