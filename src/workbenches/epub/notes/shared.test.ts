import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { createEpubCfiRangeTarget } from '../shared';
import {
  EPUB_READING_NOTE_ATTACHMENT_TYPE,
  EPUB_READING_NOTE_ATTACHMENT_VERSION,
  createEpubReadingNoteMetadata,
  findEpubReadingNoteAtTarget,
  isCreateEpubReadingNoteRequest,
  isDeleteEpubReadingNoteRequest,
  isEpubReadingNoteMetadata,
  isUpdateEpubReadingNoteRequest,
  toEpubReadingNoteView,
} from './shared';

const target = createEpubCfiRangeTarget({
  cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:8)',
  quote: { exact: '值得记录的原文', prefix: '前文', suffix: '后文' },
});

describe('EPUB reading note contracts', () => {
  it('projects only the registered authored-note Attachment type', () => {
    const attachment: AssetAttachment = {
      id: 'note-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: EPUB_READING_NOTE_ATTACHMENT_TYPE,
      typeVersion: EPUB_READING_NOTE_ATTACHMENT_VERSION,
      target,
      metadata: {
        format: 'learning-companion/epub-reading-note',
        version: 1,
        text: '这里让我想到另一个概念。',
      },
      createdTime: 1,
      updatedTime: 2,
    };

    expect(toEpubReadingNoteView(attachment)).toMatchObject({
      id: 'note-1',
      text: '这里让我想到另一个概念。',
      markerColor: 'yellow',
      target,
    });
    expect(
      toEpubReadingNoteView({
        ...attachment,
        typeId: 'epub.ai-explanation',
      }),
    ).toBeUndefined();
  });

  it('persists a supported wave color while accepting legacy notes', () => {
    expect(createEpubReadingNoteMetadata('红色笔记', 'red')).toMatchObject({
      text: '红色笔记',
      markerColor: 'red',
    });
    expect(
      isEpubReadingNoteMetadata({
        format: 'learning-companion/epub-reading-note',
        version: 1,
        text: '无效颜色',
        markerColor: 'green',
      }),
    ).toBe(false);
  });

  it('rejects blank and oversized authored note text', () => {
    expect(
      isEpubReadingNoteMetadata({
        format: 'learning-companion/epub-reading-note',
        version: 1,
        text: '  ',
      }),
    ).toBe(false);
    expect(
      isEpubReadingNoteMetadata({
        format: 'learning-companion/epub-reading-note',
        version: 1,
        text: 'a'.repeat(4_001),
      }),
    ).toBe(false);
  });

  it('finds the existing note for the exact same EPUB range', () => {
    const note = {
      id: 'note-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      target,
      text: '已有笔记',
      markerColor: 'yellow' as const,
      createdTime: 1,
      updatedTime: 1,
    };

    expect(findEpubReadingNoteAtTarget([note], target)).toBe(note);
    expect(
      findEpubReadingNoteAtTarget(
        [note],
        createEpubCfiRangeTarget({
          cfiRange: 'epubcfi(/6/4!/4/2,/1:9,/1:12)',
          quote: { exact: '另一段原文', prefix: '', suffix: '' },
        }),
      ),
    ).toBeUndefined();
  });

  it('validates scoped create, update and delete requests', () => {
    const scope = { projectId: 'project-1', assetId: 'asset-1' };
    expect(
      isCreateEpubReadingNoteRequest({
        ...scope,
        target,
        text: '新笔记',
        markerColor: 'yellow',
      }),
    ).toBe(true);
    expect(
      isUpdateEpubReadingNoteRequest({
        ...scope,
        noteId: 'note-1',
        text: '修改后',
        markerColor: 'red',
      }),
    ).toBe(true);
    expect(
      isDeleteEpubReadingNoteRequest({ ...scope, noteId: 'note-1' }),
    ).toBe(true);
    expect(
      isUpdateEpubReadingNoteRequest({
        ...scope,
        noteId: 'note-1',
        text: '',
        markerColor: 'green',
      }),
    ).toBe(false);
  });
});
