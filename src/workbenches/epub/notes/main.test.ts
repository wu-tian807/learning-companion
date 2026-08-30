import { describe, expect, it } from 'vitest';

import { AnchorRegistry } from '../../../main/attachments/anchor-registry';
import { AttachmentRegistry } from '../../../main/attachments/attachment-registry';
import { epubReadingNoteMainFeature } from './main';
import {
  EPUB_READING_NOTE_ATTACHMENT_TYPE,
  EPUB_READING_NOTE_ATTACHMENT_VERSION,
} from './shared';

describe('EPUB reading note main contribution', () => {
  it('registers a distinct authored-note Attachment metadata contract', () => {
    const attachments = new AttachmentRegistry();
    epubReadingNoteMainFeature.registerAttachmentTypes?.({
      attachments,
      anchors: new AnchorRegistry(),
    });
    const definition = attachments.get(
      EPUB_READING_NOTE_ATTACHMENT_TYPE,
      EPUB_READING_NOTE_ATTACHMENT_VERSION,
    );

    expect(
      definition?.isMetadata({
        format: 'learning-companion/epub-reading-note',
        version: 1,
        text: '个人感想',
      }),
    ).toBe(true);
    expect(
      definition?.isMetadata({
        format: 'learning-companion/epub-explanation',
        version: 1,
        text: 'AI 回答',
      }),
    ).toBe(false);
  });
});
