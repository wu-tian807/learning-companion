import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentProviderServiceApi } from '../agents/agent-provider-service';
import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import {
  registerAgentProviderHandlers,
  removeAgentProviderHandlers,
} from './agent-providers';

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

  return async (request?: unknown) => {
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

function createService(): AgentProviderServiceApi {
  return {
    getSetup: vi.fn(async () => ({
      revision: 0,
      selectedProviderId: null,
      activeProviderId: null,
      requiresSelection: true,
      providers: [],
    })),
    startLogin: vi.fn(async () => ({
      type: 'external-browser' as const,
      providerId: 'codex',
      loginId: 'login-1',
      url: 'https://chatgpt.com/login',
    })),
    cancelLogin: vi.fn(async () => undefined),
    selectProvider: vi.fn(async () => ({
      revision: 1,
      selectedProviderId: 'codex',
      activeProviderId: 'codex',
      requiresSelection: false,
      providers: [],
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Agent Provider IPC handlers', () => {
  it('checks credentials and delegates Provider login and selection', async () => {
    const service = createService();
    registerAgentProviderHandlers(service);

    await findHandler(IPC_CHANNELS.getAgentProviderSetup)({
      refreshCredentials: true,
    });
    await findHandler(IPC_CHANNELS.startAgentProviderLogin)({
      providerId: 'codex',
    });
    await findHandler(IPC_CHANNELS.cancelAgentProviderLogin)({
      providerId: 'codex',
      loginId: 'login-1',
    });
    await findHandler(IPC_CHANNELS.selectAgentProvider)({
      providerId: 'codex',
    });

    expect(service.getSetup).toHaveBeenCalledWith(true);
    expect(service.startLogin).toHaveBeenCalledWith('codex');
    expect(service.cancelLogin).toHaveBeenCalledWith(
      'codex',
      'login-1',
    );
    expect(service.selectProvider).toHaveBeenCalledWith('codex');
  });

  it('rejects malformed Provider requests', async () => {
    const service = createService();
    registerAgentProviderHandlers(service);

    await expect(
      findHandler(IPC_CHANNELS.startAgentProviderLogin)({
        providerId: '../codex',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.cancelAgentProviderLogin)({
        providerId: 'codex',
        loginId: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(service.startLogin).not.toHaveBeenCalled();
    expect(service.cancelLogin).not.toHaveBeenCalled();
  });

  it('removes every Provider handler', () => {
    removeAgentProviderHandlers();

    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.getAgentProviderSetup,
    );
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.startAgentProviderLogin,
    );
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.cancelAgentProviderLogin,
    );
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.selectAgentProvider,
    );
  });
});
