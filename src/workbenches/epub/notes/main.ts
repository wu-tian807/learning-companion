import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import {
  EPUB_READING_NOTE_ATTACHMENT_TYPE,
  EPUB_READING_NOTE_ATTACHMENT_VERSION,
  isEpubReadingNoteMetadata,
} from './shared';

export const epubReadingNoteMainFeature = Object.freeze({
  id: 'builtin.epub.reading-notes',
  registerAttachmentTypes({ attachments }): void {
    attachments.register({
      typeId: EPUB_READING_NOTE_ATTACHMENT_TYPE,
      version: EPUB_READING_NOTE_ATTACHMENT_VERSION,
      isMetadata: isEpubReadingNoteMetadata,
    });
  },
} satisfies MainWorkbenchFeatureContribution);
