import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import type { AttachmentServiceApi } from '../attachments/attachment-service';
import { registerAttachmentHandlers, removeAttachmentHandlers } from './attachments';

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

describe('Attachment IPC handlers', () => {
  it('updates registered Attachment metadata through the domain service', async () => {
    const update = vi.fn(async () => ({ id: 'note-1' }));
    registerAttachmentHandlers({ update } as unknown as AttachmentServiceApi);
    const metadata = {
      format: 'learning-companion/epub-reading-note',
      version: 1,
      text: '修改后的感想',
    };

    await expect(
      findHandler(IPC_CHANNELS.updateAttachment)({
        projectId: 'project-1',
        attachmentId: 'note-1',
        metadata,
      }),
    ).resolves.toEqual({ id: 'note-1' });
    expect(update).toHaveBeenCalledWith({
      projectId: 'project-1',
      attachmentId: 'note-1',
      metadata,
    });
  });

  it('rejects malformed metadata before reaching AttachmentService', async () => {
    const update = vi.fn();
    registerAttachmentHandlers({ update } as unknown as AttachmentServiceApi);

    await expect(
      findHandler(IPC_CHANNELS.updateAttachment)({
        projectId: 'project-1',
        attachmentId: 'note-1',
        metadata: 'invalid',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(update).not.toHaveBeenCalled();
  });

  it('removes the update handler with the Attachment surface', () => {
    removeAttachmentHandlers();
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.updateAttachment,
    );
  });
});
