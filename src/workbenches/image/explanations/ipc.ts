import { BrowserWindow, ipcMain } from 'electron';

import { AppError } from '../../../main/errors/app-error';
import { registerIpcHandler } from '../../../main/ipc/register-handler';
import type { ImageExplanationServiceApi } from './image-explanation-service';
import {
  IMAGE_EXPLANATION_IPC_CHANNELS,
  isCreateImageExplanationRequest,
  isImageExplanationIdRequest,
  isListImageExplanationsRequest,
} from './shared';

let removeSubscription: (() => void) | undefined;

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerImageExplanationHandlers(
  service: ImageExplanationServiceApi,
): void {
  removeSubscription?.();
  removeSubscription = service.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IMAGE_EXPLANATION_IPC_CHANNELS.changed, event);
      }
    }
  });

  registerIpcHandler(IMAGE_EXPLANATION_IPC_CHANNELS.list, (_event, request: unknown) => {
    if (!isListImageExplanationsRequest(request)) throw invalidRequest();
    return service.list(request);
  });
  registerIpcHandler(IMAGE_EXPLANATION_IPC_CHANNELS.create, (_event, request: unknown) => {
    if (!isCreateImageExplanationRequest(request)) throw invalidRequest();
    return service.create(request);
  });
  registerIpcHandler(IMAGE_EXPLANATION_IPC_CHANNELS.retry, (_event, request: unknown) => {
    if (!isImageExplanationIdRequest(request)) throw invalidRequest();
    return service.retry(request);
  });
  registerIpcHandler(IMAGE_EXPLANATION_IPC_CHANNELS.delete, (_event, request: unknown) => {
    if (!isImageExplanationIdRequest(request)) throw invalidRequest();
    return service.delete(request);
  });
}

export function removeImageExplanationHandlers(): void {
  removeSubscription?.();
  removeSubscription = undefined;
  ipcMain.removeHandler(IMAGE_EXPLANATION_IPC_CHANNELS.list);
  ipcMain.removeHandler(IMAGE_EXPLANATION_IPC_CHANNELS.create);
  ipcMain.removeHandler(IMAGE_EXPLANATION_IPC_CHANNELS.retry);
  ipcMain.removeHandler(IMAGE_EXPLANATION_IPC_CHANNELS.delete);
}
