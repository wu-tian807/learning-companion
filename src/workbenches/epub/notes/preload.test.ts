import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchFeatureIpcInvoke } from '../../../preload/workbench-preload-contribution';
import { createEpubCfiRangeTarget } from '../shared';
import { createEpubReadingNotePreloadApi } from './preload';
import { EPUB_READING_NOTE_IPC_CHANNELS } from './shared';

describe('EPUB reading-note Preload API', () => {
  it('keeps all reading-note transport names inside the EPUB contribution', async () => {
    const invoke = vi.fn(async () => ({ id: 'note-1' }));
    const api = createEpubReadingNotePreloadApi(
      invoke as unknown as WorkbenchFeatureIpcInvoke,
    );
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

    await api.createEpubReadingNote(createRequest);
    await api.updateEpubReadingNote(updateRequest);
    await api.deleteEpubReadingNote(deleteRequest);

    expect(invoke.mock.calls).toEqual([
      [EPUB_READING_NOTE_IPC_CHANNELS.create, createRequest],
      [EPUB_READING_NOTE_IPC_CHANNELS.update, updateRequest],
      [EPUB_READING_NOTE_IPC_CHANNELS.delete, deleteRequest],
    ]);
  });
});
