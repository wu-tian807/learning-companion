import { BrowserWindow, ipcMain } from 'electron';

import { AppError } from '../../../main/errors/app-error';
import { registerIpcHandler } from '../../../main/ipc/register-handler';
import type { EpubExplanationServiceApi } from './epub-explanation-service';
import {
  EPUB_EXPLANATION_IPC_CHANNELS,
  isCreateEpubExplanationRequest,
  isEpubExplanationIdRequest,
  isListEpubExplanationsRequest,
} from './shared';

let removeSubscription: (() => void) | undefined;

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerEpubExplanationHandlers(
  service: EpubExplanationServiceApi,
): void {
  removeSubscription?.();
  removeSubscription = service.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(EPUB_EXPLANATION_IPC_CHANNELS.changed, event);
      }
    }
  });

  registerIpcHandler(
    EPUB_EXPLANATION_IPC_CHANNELS.list,
    (_event, request: unknown) => {
      if (!isListEpubExplanationsRequest(request)) throw invalidRequest();
      return service.list(request);
    },
  );
  registerIpcHandler(
    EPUB_EXPLANATION_IPC_CHANNELS.create,
    (_event, request: unknown) => {
      if (!isCreateEpubExplanationRequest(request)) throw invalidRequest();
      return service.create(request);
    },
  );
  registerIpcHandler(
    EPUB_EXPLANATION_IPC_CHANNELS.retry,
    (_event, request: unknown) => {
      if (!isEpubExplanationIdRequest(request)) throw invalidRequest();
      return service.retry(request);
    },
  );
  registerIpcHandler(
    EPUB_EXPLANATION_IPC_CHANNELS.delete,
    (_event, request: unknown) => {
      if (!isEpubExplanationIdRequest(request)) throw invalidRequest();
      return service.delete(request);
    },
  );
}

export function removeEpubExplanationHandlers(): void {
  removeSubscription?.();
  removeSubscription = undefined;
  ipcMain.removeHandler(EPUB_EXPLANATION_IPC_CHANNELS.list);
  ipcMain.removeHandler(EPUB_EXPLANATION_IPC_CHANNELS.create);
  ipcMain.removeHandler(EPUB_EXPLANATION_IPC_CHANNELS.retry);
  ipcMain.removeHandler(EPUB_EXPLANATION_IPC_CHANNELS.delete);
}
