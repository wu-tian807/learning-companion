import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import {
  createAssetContentStatus,
  createLocalFileContentRef,
} from '../content/content-ref';
import { createAssetSnapshot } from '../assets/asset';
import type { AssetShellServiceApi } from '../assets/asset-shell-service';
import type { AssetServiceApi } from '../assets/asset-service';
import { AppError } from '../errors/app-error';
import type { SettingsRepository } from '../settings/settings-repository';
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
  const currentAssets = [asset];
  const assetService = {
    addLocalFile: vi.fn(async (_projectId: string, path: string) => {
      if (path.includes('failed')) {
        throw new AppError('ASSET_UNAVAILABLE');
      }

      const created = createAsset(path, path);
      currentAssets.push(created);
      return created;
    }),
    update: vi.fn(() => asset),
    relinkLocalFile: vi.fn(async () => asset),
    delete: vi.fn(),
    refresh: vi.fn(async () => asset),
    refreshAll: vi.fn(async () => [asset]),
    getActiveProjectId: vi.fn(() => 'project'),
    list: vi.fn(() => [...currentAssets]),
  } as unknown as AssetServiceApi;
  const assetShellService = {
    revealInFolder: vi.fn(),
  } as unknown as AssetShellServiceApi;
  const settingsRepository = {
    getLastLocalAssetDirectory: vi.fn(() => undefined),
    updateLastLocalAssetDirectory: vi.fn(async () => undefined),
  } as unknown as SettingsRepository;

  return {
    asset,
    assetService,
    assetShellService,
    settingsRepository,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Asset IPC handlers', () => {
  it('selects multiple files and returns an empty list after cancellation', async () => {
    const { assetService, assetShellService, settingsRepository } =
      createDependencies();
    registerAssetHandlers(
      assetService,
      assetShellService,
      settingsRepository,
    );
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
    expect(
      settingsRepository.updateLastLocalAssetDirectory,
    ).toHaveBeenCalledWith('/tmp');

    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    });
    await expect(
      findHandler(IPC_CHANNELS.selectLocalAssetFiles)({}),
    ).resolves.toEqual([]);
  });

  it('opens in and updates the remembered local Asset directory', async () => {
    const { assetService, assetShellService, settingsRepository } =
      createDependencies();
    vi.mocked(
      settingsRepository.getLastLocalAssetDirectory,
    ).mockReturnValue('/tmp/previous');
    registerAssetHandlers(
      assetService,
      assetShellService,
      settingsRepository,
    );
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/current/a.md', '/tmp/current/b.pdf'],
    });

    await expect(
      findHandler(IPC_CHANNELS.selectLocalAssetFiles)({}),
    ).resolves.toEqual([
      '/tmp/current/a.md',
      '/tmp/current/b.pdf',
    ]);
    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
      defaultPath: '/tmp/previous',
      properties: ['openFile', 'multiSelections'],
    });
    expect(
      settingsRepository.updateLastLocalAssetDirectory,
    ).toHaveBeenCalledWith('/tmp/current');
  });

  it('returns selected files when remembering the directory fails', async () => {
    const { assetService, assetShellService, settingsRepository } =
      createDependencies();
    vi.mocked(
      settingsRepository.updateLastLocalAssetDirectory,
    ).mockRejectedValueOnce(new Error('disk full'));
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    registerAssetHandlers(
      assetService,
      assetShellService,
      settingsRepository,
    );
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/current/a.md'],
    });

    try {
      await expect(
        findHandler(IPC_CHANNELS.selectLocalAssetFiles)({}),
      ).resolves.toEqual(['/tmp/current/a.md']);
      expect(warn).toHaveBeenCalledWith(
        '文件选择器最近目录保存失败。',
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps successful files when a batch addition partially fails', async () => {
    const { assetService, assetShellService, settingsRepository } =
      createDependencies();
    registerAssetHandlers(
      assetService,
      assetShellService,
      settingsRepository,
    );

    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)(
        {},
        {
          projectId: 'project',
          paths: ['/tmp/a.md', '/tmp/failed.md', '/tmp/b.md'],
        },
      ),
    ).resolves.toMatchObject({
      added: [
        { id: '/tmp/a.md', contentRef: { path: '/tmp/a.md' } },
        { id: '/tmp/b.md', contentRef: { path: '/tmp/b.md' } },
      ],
      failed: [
        {
          path: '/tmp/failed.md',
          message: '所选文件当前不可用，请检查文件是否存在以及访问权限。',
        },
      ],
      assets: [
        { id: 'asset' },
        { id: '/tmp/a.md' },
        { id: '/tmp/b.md' },
      ],
    });
    expect(assetService.addLocalFile).toHaveBeenCalledTimes(3);
    expect(assetService.addLocalFile).toHaveBeenNthCalledWith(
      1,
      'project',
      '/tmp/a.md',
    );
    expect(assetService.list).toHaveBeenCalledOnce();
  });

  it('stops a batch instead of treating a Project switch as a file failure', async () => {
    const { assetService, assetShellService, settingsRepository } =
      createDependencies();
    vi.mocked(assetService.addLocalFile).mockRejectedValueOnce(
      new AppError('PROJECT_CONTEXT_CHANGED'),
    );
    registerAssetHandlers(
      assetService,
      assetShellService,
      settingsRepository,
    );

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
    expect(assetService.addLocalFile).toHaveBeenCalledOnce();
    expect(assetService.list).not.toHaveBeenCalled();
  });

  it('rejects a batch that targets a Project other than the active Project', async () => {
    const { assetService, assetShellService, settingsRepository } =
      createDependencies();
    registerAssetHandlers(
      assetService,
      assetShellService,
      settingsRepository,
    );

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

  it('forwards Asset mutations to the current Project container', async () => {
    const { assetService, assetShellService, settingsRepository } =
      createDependencies();
    registerAssetHandlers(
      assetService,
      assetShellService,
      settingsRepository,
    );

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
    expect(assetShellService.revealInFolder).toHaveBeenCalledWith('asset');
  });

  it('rejects malformed requests before reaching the back end', async () => {
    const { assetService, assetShellService, settingsRepository } =
      createDependencies();
    registerAssetHandlers(
      assetService,
      assetShellService,
      settingsRepository,
    );

    await expect(
      findHandler(IPC_CHANNELS.addLocalAssets)(
        {},
        { projectId: 'project', paths: [] },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.renameAsset)(
        {},
        { assetId: 'asset', name: '' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(assetService.addLocalFile).not.toHaveBeenCalled();
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
