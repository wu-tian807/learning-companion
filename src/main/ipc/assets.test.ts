import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import {
  createAssetContentStatus,
  createLocalFileContentRef,
} from '../content/content-ref';
import { createAssetSnapshot } from '../assets/asset';
import type { AssetFileServiceApi } from '../assets/asset-file-service';
import type { AssetServiceApi } from '../assets/asset-service';
import { AppError } from '../errors/app-error';
import type { ProjectServiceApi } from '../projects/project-service';
import { registerAssetHandlers, removeAssetHandlers } from './assets';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
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
  const contentRef = createLocalFileContentRef(path);

  return {
    ...createAssetSnapshot({
      id,
      projectId: 'project',
      name: '学习笔记',
      mediaType: 'text/markdown',
      contentRef,
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
  const assetService = {
    addLocalFile: vi.fn(async (path: string) => {
      if (path.includes('failed')) {
        throw new AppError('ASSET_UNAVAILABLE');
      }

      return createAsset(path, path);
    }),
    update: vi.fn(() => asset),
    relinkLocalFile: vi.fn(async () => asset),
    delete: vi.fn(),
    refresh: vi.fn(async () => asset),
    refreshAll: vi.fn(async () => [asset]),
    getActiveProjectId: vi.fn(() => 'project'),
  } as unknown as AssetServiceApi;
  const projectService = {
    openProject: vi.fn(async () => [asset]),
    closeProject: vi.fn(),
  } as unknown as ProjectServiceApi;
  const assetFileService = {
    revealInFolder: vi.fn(),
  } as unknown as AssetFileServiceApi;

  return { asset, assetService, assetFileService, projectService };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Asset IPC handlers', () => {
  it('opens and closes Project workspaces with serializable Assets', async () => {
    const { assetService, assetFileService, projectService } =
      createDependencies();
    registerAssetHandlers(assetService, assetFileService, projectService);

    await expect(
      findHandler(IPC_CHANNELS.openProject)({}, { projectId: 'project' }),
    ).resolves.toEqual([
      {
        id: 'asset',
        projectId: 'project',
        name: '学习笔记',
        mediaType: 'text/markdown',
        contentLocator: {
          kind: 'local-file',
          path: '/tmp/notes.md',
          availability: 'available',
          checkedTime: '2026-07-27T02:00:00.000Z',
        },
        createdTime: '2026-07-27T01:00:00.000Z',
        lastUsedTime: '2026-07-27T03:00:00.000Z',
      },
    ]);

    await findHandler(IPC_CHANNELS.closeProject)(
      {},
      { projectId: 'project' },
    );
    expect(projectService.openProject).toHaveBeenCalledWith('project');
    expect(projectService.closeProject).toHaveBeenCalledWith('project');
  });

  it('selects multiple files and returns an empty list after cancellation', async () => {
    const { assetService, assetFileService, projectService } =
      createDependencies();
    registerAssetHandlers(assetService, assetFileService, projectService);
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/a.md', '/tmp/b.pdf'],
    });

    await expect(
      findHandler(IPC_CHANNELS.selectLocalAssetFiles)({}),
    ).resolves.toEqual(['/tmp/a.md', '/tmp/b.pdf']);
    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections'],
    });

    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    });
    await expect(
      findHandler(IPC_CHANNELS.selectLocalAssetFiles)({}),
    ).resolves.toEqual([]);
  });

  it('keeps successful files when a batch addition partially fails', async () => {
    const { assetService, assetFileService, projectService } =
      createDependencies();
    registerAssetHandlers(assetService, assetFileService, projectService);

    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)(
        {},
        { paths: ['/tmp/a.md', '/tmp/failed.md', '/tmp/b.md'] },
      ),
    ).resolves.toMatchObject({
      added: [
        { id: '/tmp/a.md', contentLocator: { path: '/tmp/a.md' } },
        { id: '/tmp/b.md', contentLocator: { path: '/tmp/b.md' } },
      ],
      failed: [
        {
          path: '/tmp/failed.md',
          message: '所选文件当前不可用，请检查文件是否存在以及访问权限。',
        },
      ],
    });
    expect(assetService.addLocalFile).toHaveBeenCalledTimes(3);
  });

  it('forwards Asset mutations to the current Project container', async () => {
    const { assetService, assetFileService, projectService } =
      createDependencies();
    registerAssetHandlers(assetService, assetFileService, projectService);

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
    expect(assetFileService.revealInFolder).toHaveBeenCalledWith('asset');
  });

  it('rejects malformed requests before reaching the back end', async () => {
    const { assetService, assetFileService, projectService } =
      createDependencies();
    registerAssetHandlers(assetService, assetFileService, projectService);

    await expect(
      findHandler(IPC_CHANNELS.openProject)({}, { projectId: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)({}, { paths: [] }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.renameAsset)(
        {},
        { assetId: 'asset', name: '' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(assetService.addLocalFile).not.toHaveBeenCalled();
    expect(projectService.openProject).not.toHaveBeenCalled();
  });

  it('removes every Asset handler', () => {
    removeAssetHandlers();

    for (const channel of [
      IPC_CHANNELS.openProject,
      IPC_CHANNELS.closeProject,
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
