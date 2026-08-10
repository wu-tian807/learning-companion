import { BrowserWindow, ipcMain } from 'electron';

import { AppError } from '../../../main/errors/app-error';
import { registerIpcHandler } from '../../../main/ipc/register-handler';
import { IPC_CHANNELS } from '../../../shared/ipc';
import type { EpubExplanationServiceApi } from './epub-explanation-service';
import {
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
        window.webContents.send(IPC_CHANNELS.epubExplanationChanged, event);
      }
    }
  });

  registerIpcHandler(
    IPC_CHANNELS.listEpubExplanations,
    (_event, request: unknown) => {
      if (!isListEpubExplanationsRequest(request)) throw invalidRequest();
      return service.list(request);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.createEpubExplanation,
    (_event, request: unknown) => {
      if (!isCreateEpubExplanationRequest(request)) throw invalidRequest();
      return service.create(request);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.retryEpubExplanation,
    (_event, request: unknown) => {
      if (!isEpubExplanationIdRequest(request)) throw invalidRequest();
      return service.retry(request);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.deleteEpubExplanation,
    (_event, request: unknown) => {
      if (!isEpubExplanationIdRequest(request)) throw invalidRequest();
      return service.delete(request);
    },
  );
}

export function removeEpubExplanationHandlers(): void {
  removeSubscription?.();
  removeSubscription = undefined;
  ipcMain.removeHandler(IPC_CHANNELS.listEpubExplanations);
  ipcMain.removeHandler(IPC_CHANNELS.createEpubExplanation);
  ipcMain.removeHandler(IPC_CHANNELS.retryEpubExplanation);
  ipcMain.removeHandler(IPC_CHANNELS.deleteEpubExplanation);
}
