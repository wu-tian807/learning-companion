import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { createEpubCfiRangeTarget } from '../shared';
import {
  EPUB_READING_NOTE_ATTACHMENT_TYPE,
  EPUB_READING_NOTE_ATTACHMENT_VERSION,
  findEpubReadingNoteAtTarget,
  isEpubReadingNoteMetadata,
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
      target,
    });
    expect(
      toEpubReadingNoteView({
        ...attachment,
        typeId: 'epub.ai-explanation',
      }),
    ).toBeUndefined();
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
});
