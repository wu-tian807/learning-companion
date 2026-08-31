import type { WorkbenchFeatureIpcInvoke } from '../../../preload/workbench-preload-contribution';
import {
  EPUB_READING_NOTE_IPC_CHANNELS,
  type EpubReadingNotePreloadApi,
  type EpubReadingNoteView,
} from './shared';

export function createEpubReadingNotePreloadApi(
  invoke: WorkbenchFeatureIpcInvoke,
): EpubReadingNotePreloadApi {
  return Object.freeze({
    createEpubReadingNote: (request) =>
      invoke<EpubReadingNoteView>(
        EPUB_READING_NOTE_IPC_CHANNELS.create,
        request,
      ),
    updateEpubReadingNote: (request) =>
      invoke<EpubReadingNoteView>(
        EPUB_READING_NOTE_IPC_CHANNELS.update,
        request,
      ),
    deleteEpubReadingNote: (request) =>
      invoke<void>(EPUB_READING_NOTE_IPC_CHANNELS.delete, request),
  } satisfies EpubReadingNotePreloadApi);
}
