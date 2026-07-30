import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APP_PREFERENCES } from '../../shared/app-preferences';
import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import type { SettingsRepository } from '../settings/settings-repository';
import { registerSettingsHandlers, removeSettingsHandlers } from './settings';

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

function createRepository() {
  const get = vi.fn(() => DEFAULT_APP_PREFERENCES);
  const updateHomePreferences = vi.fn(async () => ({
    schemaVersion: 1 as const,
    home: {
      viewMode: 'list' as const,
      sortMode: 'title' as const,
    },
  }));
  const repository: SettingsRepository = {
    initialize: vi.fn(async () => undefined),
    get,
    updateHomePreferences,
    getDefaultProjectWorkspace: vi.fn(() => '/tmp/projects'),
    updateDefaultProjectWorkspace: vi.fn(async () => undefined),
  };

  return { get, repository, updateHomePreferences };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settings IPC handlers', () => {
  it('returns the repository settings', async () => {
    const { get, repository } = createRepository();
    registerSettingsHandlers(repository);

    const result = await findHandler(IPC_CHANNELS.getAppPreferences)({});

    expect(result).toEqual(DEFAULT_APP_PREFERENCES);
    expect(get).toHaveBeenCalledOnce();
  });

  it('validates and forwards home preference updates', async () => {
    const { repository, updateHomePreferences } = createRepository();
    registerSettingsHandlers(repository);

    const result = await findHandler(IPC_CHANNELS.updateHomePreferences)({}, {
      viewMode: 'list',
      sortMode: 'title',
    });

    expect(result).toEqual({
      schemaVersion: 1,
      home: {
        viewMode: 'list',
        sortMode: 'title',
      },
    });
    expect(updateHomePreferences).toHaveBeenCalledWith({
      viewMode: 'list',
      sortMode: 'title',
    });
  });

  it('rejects malformed updates before reaching the repository', async () => {
    const { repository, updateHomePreferences } = createRepository();
    registerSettingsHandlers(repository);

    await expect(
      findHandler(IPC_CHANNELS.updateHomePreferences)({}, {
        viewMode: 'compact',
        sortMode: 'newest',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(updateHomePreferences).not.toHaveBeenCalled();
  });

  it('removes every settings handler', () => {
    removeSettingsHandlers();

    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.getAppPreferences,
    );
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.updateHomePreferences,
    );
  });
});
