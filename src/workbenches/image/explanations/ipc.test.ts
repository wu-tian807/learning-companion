import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isIpcResult } from '../../../shared/ipc-error';
import type { ImageExplanationServiceApi } from './image-explanation-service';
import {
  registerImageExplanationHandlers,
  removeImageExplanationHandlers,
} from './ipc';
import { IMAGE_EXPLANATION_IPC_CHANNELS } from './shared';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
  getAllWindows: vi.fn(() => []),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

function findHandler(channel: string) {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );
  if (!registration) throw new Error(`找不到 ${channel} handler`);
  const handler = registration[1] as (
    event: unknown,
    request: unknown,
  ) => Promise<unknown>;
  return async (request: unknown) => {
    const result = await handler({}, request);
    if (!isIpcResult<unknown>(result)) throw new Error('IPC 测试响应无效');
    if (!result.ok) throw result.error;
    return result.data;
  };
}

beforeEach(() => vi.clearAllMocks());

describe('image explanation IPC', () => {
  it('routes a validated revision-scoped marker-color update', async () => {
    const updateMarkerColor = vi.fn(async () => ({ id: 'attachment-1' }));
    registerImageExplanationHandlers({
      updateMarkerColor,
      subscribe: () => () => undefined,
    } as unknown as ImageExplanationServiceApi);
    const request = {
      projectId: 'project-1',
      assetId: 'asset-1',
      explanationId: 'attachment-1',
      sourceRevision: 'revision-1',
      markerColor: 'red',
    } as const;

    await expect(
      findHandler(IMAGE_EXPLANATION_IPC_CHANNELS.updateMarkerColor)(request),
    ).resolves.toEqual({ id: 'attachment-1' });
    expect(updateMarkerColor).toHaveBeenCalledWith(request);
  });

  it('rejects unsupported colors before the service boundary', async () => {
    const updateMarkerColor = vi.fn();
    registerImageExplanationHandlers({
      updateMarkerColor,
      subscribe: () => () => undefined,
    } as unknown as ImageExplanationServiceApi);
    await expect(
      findHandler(IMAGE_EXPLANATION_IPC_CHANNELS.updateMarkerColor)({
        projectId: 'project-1',
        assetId: 'asset-1',
        explanationId: 'attachment-1',
        sourceRevision: 'revision-1',
        markerColor: 'green',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(updateMarkerColor).not.toHaveBeenCalled();
  });

  it('removes the marker-color handler with the image feature runtime', () => {
    removeImageExplanationHandlers();
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IMAGE_EXPLANATION_IPC_CHANNELS.updateMarkerColor,
    );
  });
});
