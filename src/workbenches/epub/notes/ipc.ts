import { ipcMain } from 'electron';

import { AppError } from '../../../main/errors/app-error';
import { registerIpcHandler } from '../../../main/ipc/register-handler';
import type { EpubReadingNoteServiceApi } from './epub-reading-note-service';
import {
  EPUB_READING_NOTE_IPC_CHANNELS,
  isCreateEpubReadingNoteRequest,
  isDeleteEpubReadingNoteRequest,
  isUpdateEpubReadingNoteRequest,
} from './shared';

function invalidRequest(): AppError {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerEpubReadingNoteHandlers(
  service: EpubReadingNoteServiceApi,
): void {
  registerIpcHandler(
    EPUB_READING_NOTE_IPC_CHANNELS.create,
    (_event, request: unknown) => {
      if (!isCreateEpubReadingNoteRequest(request)) throw invalidRequest();
      return service.create(request);
    },
  );
  registerIpcHandler(
    EPUB_READING_NOTE_IPC_CHANNELS.update,
    (_event, request: unknown) => {
      if (!isUpdateEpubReadingNoteRequest(request)) throw invalidRequest();
      return service.update(request);
    },
  );
  registerIpcHandler(
    EPUB_READING_NOTE_IPC_CHANNELS.delete,
    (_event, request: unknown) => {
      if (!isDeleteEpubReadingNoteRequest(request)) throw invalidRequest();
      return service.delete(request);
    },
  );
}

export function removeEpubReadingNoteHandlers(): void {
  ipcMain.removeHandler(EPUB_READING_NOTE_IPC_CHANNELS.create);
  ipcMain.removeHandler(EPUB_READING_NOTE_IPC_CHANNELS.update);
  ipcMain.removeHandler(EPUB_READING_NOTE_IPC_CHANNELS.delete);
}
