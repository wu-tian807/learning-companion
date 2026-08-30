import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isIpcResult } from '../../../shared/ipc-error';
import { createEpubCfiRangeTarget } from '../shared';
import type { EpubReadingNoteServiceApi } from './epub-reading-note-service';
import {
  registerEpubReadingNoteHandlers,
  removeEpubReadingNoteHandlers,
} from './ipc';
import { EPUB_READING_NOTE_IPC_CHANNELS } from './shared';

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

describe('EPUB reading-note IPC', () => {
  it('routes typed create, update and delete requests to the EPUB service', async () => {
    const service = {
      create: vi.fn(async () => ({ id: 'note-1' })),
      update: vi.fn(async () => ({ id: 'note-1' })),
      delete: vi.fn(async () => undefined),
    } as unknown as EpubReadingNoteServiceApi;
    registerEpubReadingNoteHandlers(service);
    const scope = { projectId: 'project-1', assetId: 'asset-1' };
    const createRequest = {
      ...scope,
      target: createEpubCfiRangeTarget({
        cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:8)',
        quote: { exact: '原文', prefix: '', suffix: '' },
      }),
      text: '阅读笔记',
      markerColor: 'yellow',
    } as const;
    const updateRequest = {
      ...scope,
      noteId: 'note-1',
      text: '修改后的笔记',
      markerColor: 'red',
    } as const;
    const deleteRequest = { ...scope, noteId: 'note-1' };

    await findHandler(EPUB_READING_NOTE_IPC_CHANNELS.create)(createRequest);
    await findHandler(EPUB_READING_NOTE_IPC_CHANNELS.update)(updateRequest);
    await findHandler(EPUB_READING_NOTE_IPC_CHANNELS.delete)(deleteRequest);

    expect(service.create).toHaveBeenCalledWith(createRequest);
    expect(service.update).toHaveBeenCalledWith(updateRequest);
    expect(service.delete).toHaveBeenCalledWith(deleteRequest);
  });

  it('rejects blank notes and unsupported colors at the feature boundary', async () => {
    const update = vi.fn();
    registerEpubReadingNoteHandlers({
      update,
    } as unknown as EpubReadingNoteServiceApi);

    await expect(
      findHandler(EPUB_READING_NOTE_IPC_CHANNELS.update)({
        projectId: 'project-1',
        assetId: 'asset-1',
        noteId: 'note-1',
        text: '  ',
        markerColor: 'green',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(update).not.toHaveBeenCalled();
  });

  it('removes all feature-owned handlers on disposal', () => {
    removeEpubReadingNoteHandlers();
    expect(electronMocks.removeHandler.mock.calls.map(([channel]) => channel))
      .toEqual([
        EPUB_READING_NOTE_IPC_CHANNELS.create,
        EPUB_READING_NOTE_IPC_CHANNELS.update,
        EPUB_READING_NOTE_IPC_CHANNELS.delete,
      ]);
  });
});
