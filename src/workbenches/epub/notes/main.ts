import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { EpubReadingNoteService } from './epub-reading-note-service';
import {
  registerEpubReadingNoteHandlers,
  removeEpubReadingNoteHandlers,
} from './ipc';
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
  start({ attachments, assets }) {
    const service = new EpubReadingNoteService(attachments, assets);
    try {
      registerEpubReadingNoteHandlers(service);
    } catch (error) {
      removeEpubReadingNoteHandlers();
      throw error;
    }
    let disposed = false;
    return Object.freeze({
      dispose(): void {
        if (disposed) return;
        disposed = true;
        removeEpubReadingNoteHandlers();
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
