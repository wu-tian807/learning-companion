import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import type { WorkbenchSessionManagerApi } from '../workbench/workbench-session-manager';
import {
  registerWorkbenchHandlers,
  removeWorkbenchHandlers,
} from './workbench';

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

function findHandler(channel: string) {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );

  if (!registration) {
    throw new Error(`找不到 ${channel} handler`);
  }

  const handler = registration[1] as RegisteredIpcHandler;

  return async (request: unknown) => {
    const result = await handler({}, request);

    if (!isIpcResult<unknown>(result)) {
      throw new Error('IPC 测试响应无效');
    }

    if (!result.ok) {
      throw result.error;
    }

    return result.data;
  };
}

function createManager() {
  return {
    open: vi.fn(async (assetId: string) => ({
      sessionId: 'session',
      workbenchId: 'builtin.unsupported',
      protocolVersion: 1,
      assetId,
      mediaType: 'text/plain',
      availability: 'available',
      payload: { reason: 'unsupported-media' },
    })),
    command: vi.fn(async (_sessionId, command) => ({
      payload: { command: command.type },
    })),
    close: vi.fn(async () => undefined),
  } as unknown as WorkbenchSessionManagerApi;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Workbench IPC handlers', () => {
  it('forwards validated lifecycle requests to the manager', async () => {
    const manager = createManager();
    registerWorkbenchHandlers(manager);

    await expect(
      findHandler(IPC_CHANNELS.openWorkbench)({ assetId: 'asset' }),
    ).resolves.toMatchObject({
      sessionId: 'session',
      assetId: 'asset',
    });
    await expect(
      findHandler(IPC_CHANNELS.commandWorkbench)({
        sessionId: 'session',
        command: { type: 'navigate', payload: { page: 2 } },
      }),
    ).resolves.toEqual({ payload: { command: 'navigate' } });
    await expect(
      findHandler(IPC_CHANNELS.closeWorkbench)({ sessionId: 'session' }),
    ).resolves.toBeUndefined();

    expect(manager.open).toHaveBeenCalledWith('asset');
    expect(manager.command).toHaveBeenCalledWith('session', {
      type: 'navigate',
      payload: { page: 2 },
    });
    expect(manager.close).toHaveBeenCalledWith('session');
  });

  it('rejects malformed requests before calling the manager', async () => {
    const manager = createManager();
    registerWorkbenchHandlers(manager);

    await expect(
      findHandler(IPC_CHANNELS.openWorkbench)({ assetId: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.commandWorkbench)({
        sessionId: 'session',
        command: { type: '', payload: Number.NaN },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.closeWorkbench)({}),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('removes every Workbench handler', () => {
    removeWorkbenchHandlers();

    expect(electronMocks.removeHandler.mock.calls).toEqual([
      [IPC_CHANNELS.openWorkbench],
      [IPC_CHANNELS.commandWorkbench],
      [IPC_CHANNELS.closeWorkbench],
    ]);
  });
});
