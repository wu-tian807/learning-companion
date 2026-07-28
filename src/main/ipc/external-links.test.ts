import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import {
  registerExternalLinkHandler,
  removeExternalLinkHandler,
} from './external-links';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  openExternal: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
  shell: {
    openExternal: electronMocks.openExternal,
  },
}));

type RegisteredIpcHandler = (event: unknown, request?: unknown) => unknown;

function findHandler() {
  const registration = electronMocks.handle.mock.calls.find(
    ([channel]) => channel === IPC_CHANNELS.openExternal,
  );

  if (!registration) {
    throw new Error('找不到外部链接 handler');
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

beforeEach(() => {
  vi.clearAllMocks();
  electronMocks.openExternal.mockResolvedValue(undefined);
});

describe('External link IPC handler', () => {
  it('opens a validated web URL in the operating system', async () => {
    registerExternalLinkHandler();

    await expect(
      findHandler()({
        url: 'https://EXAMPLE.com:443/guide/../reference',
      }),
    ).resolves.toBeUndefined();
    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      'https://example.com/reference',
    );
  });

  it('rejects non-web URLs before reaching Electron shell', async () => {
    registerExternalLinkHandler();

    await expect(
      findHandler()({ url: 'file:///tmp/private.txt' }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
  });

  it('removes its handler', () => {
    removeExternalLinkHandler();

    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.openExternal,
    );
  });
});
