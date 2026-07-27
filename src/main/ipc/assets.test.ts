import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipc';
import { createAssetSnapshot } from '../assets/asset';
import { createLocalFileContentLocator } from '../assets/asset-content-locator';
import type { AssetDatabaseApi } from '../assets/asset-database';
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

type IpcHandler = (event: unknown, request?: unknown) => unknown;

function findHandler(channel: string): IpcHandler {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );

  if (!registration) {
    throw new Error(`找不到 ${channel} handler`);
  }

  return registration[1] as IpcHandler;
}

function createAsset(id = 'asset', path = '/tmp/notes.md') {
  return createAssetSnapshot({
    id,
    projectId: 'project',
    name: '学习笔记',
    mediaType: 'text/markdown',
    contentLocator: createLocalFileContentLocator({
      path,
      availability: 'available',
      checkedTime: new Date('2026-07-27T02:00:00.000Z'),
    }),
    createdTime: new Date('2026-07-27T01:00:00.000Z'),
    lastUsedTime: new Date('2026-07-27T03:00:00.000Z'),
  });
}

function createDependencies() {
  const asset = createAsset();
  const assetDatabase = {
    add: vi.fn(async ({ path }: { path: string }) => {
      if (path.includes('failed')) {
        throw new Error('文件不可用');
      }

      return createAsset(path, path);
    }),
    update: vi.fn(() => asset),
    relink: vi.fn(async () => asset),
    delete: vi.fn(),
    refreshAvailability: vi.fn(async () => asset),
  } as unknown as AssetDatabaseApi;
  const projectService = {
    openProject: vi.fn(async () => [asset]),
    closeProject: vi.fn(),
  } as unknown as ProjectServiceApi;

  return { asset, assetDatabase, projectService };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Asset IPC handlers', () => {
  it('opens and closes Project workspaces with serializable Assets', async () => {
    const { assetDatabase, projectService } = createDependencies();
    registerAssetHandlers(assetDatabase, projectService);

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

    findHandler(IPC_CHANNELS.closeProject)({}, { projectId: 'project' });
    expect(projectService.openProject).toHaveBeenCalledWith('project');
    expect(projectService.closeProject).toHaveBeenCalledWith('project');
  });

  it('selects multiple files and returns an empty list after cancellation', async () => {
    const { assetDatabase, projectService } = createDependencies();
    registerAssetHandlers(assetDatabase, projectService);
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
    const { assetDatabase, projectService } = createDependencies();
    registerAssetHandlers(assetDatabase, projectService);

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
      failed: [{ path: '/tmp/failed.md', message: '文件不可用' }],
    });
    expect(assetDatabase.add).toHaveBeenCalledTimes(3);
  });

  it('forwards Asset mutations to the current Project container', async () => {
    const { assetDatabase, projectService } = createDependencies();
    registerAssetHandlers(assetDatabase, projectService);

    findHandler(IPC_CHANNELS.renameAsset)(
      {},
      { assetId: 'asset', name: '新标题' },
    );
    await findHandler(IPC_CHANNELS.relinkAsset)(
      {},
      { assetId: 'asset', path: '/tmp/new.md' },
    );
    findHandler(IPC_CHANNELS.deleteAsset)({}, { assetId: 'asset' });
    await findHandler(IPC_CHANNELS.refreshAsset)({}, { assetId: 'asset' });

    expect(assetDatabase.update).toHaveBeenCalledWith('asset', {
      name: '新标题',
    });
    expect(assetDatabase.relink).toHaveBeenCalledWith('asset', '/tmp/new.md');
    expect(assetDatabase.delete).toHaveBeenCalledWith('asset');
    expect(assetDatabase.refreshAvailability).toHaveBeenCalledWith('asset');
  });

  it('rejects malformed requests before reaching the back end', async () => {
    const { assetDatabase, projectService } = createDependencies();
    registerAssetHandlers(assetDatabase, projectService);

    await expect(
      findHandler(IPC_CHANNELS.openProject)({}, { projectId: '' }),
    ).rejects.toThrow('Asset 打开 Project请求无效');
    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)({}, { paths: [] }),
    ).rejects.toThrow('Asset 批量添加请求无效');
    expect(() =>
      findHandler(IPC_CHANNELS.renameAsset)(
        {},
        { assetId: 'asset', name: '' },
      ),
    ).toThrow('Asset 重命名请求无效');
    expect(assetDatabase.add).not.toHaveBeenCalled();
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
    ]) {
      expect(electronMocks.removeHandler).toHaveBeenCalledWith(channel);
    }
  });
});
