import { describe, expect, it } from 'vitest';

import { AnchorRegistry } from '../../main/attachments/anchor-registry';
import { AttachmentRegistry } from '../../main/attachments/attachment-registry';
import { epubMainWorkbenchContribution } from './main-contribution';
import {
  EPUB_EXPLANATION_ATTACHMENT_TYPE,
  EPUB_EXPLANATION_ATTACHMENT_VERSION,
} from './explanations/shared';
import {
  EPUB_READING_NOTE_ATTACHMENT_TYPE,
  EPUB_READING_NOTE_ATTACHMENT_VERSION,
} from './notes/shared';
import {
  EPUB_CFI_RANGE_ANCHOR_TYPE,
  EPUB_CFI_RANGE_ANCHOR_VERSION,
} from './shared';

describe('EPUB main contribution composition', () => {
  it('registers the shared CFI anchor once and keeps AI/authored Attachment types distinct', () => {
    const attachments = new AttachmentRegistry();
    const anchors = new AnchorRegistry();

    epubMainWorkbenchContribution.registerAttachmentTypes?.({
      attachments,
      anchors,
    });

    expect(
      anchors.get(
        EPUB_CFI_RANGE_ANCHOR_TYPE,
        EPUB_CFI_RANGE_ANCHOR_VERSION,
      ),
    ).toBeDefined();
    expect(
      attachments.get(
        EPUB_EXPLANATION_ATTACHMENT_TYPE,
        EPUB_EXPLANATION_ATTACHMENT_VERSION,
      ),
    ).toBeDefined();
    expect(
      attachments.get(
        EPUB_READING_NOTE_ATTACHMENT_TYPE,
        EPUB_READING_NOTE_ATTACHMENT_VERSION,
      ),
    ).toBeDefined();
  });
});
