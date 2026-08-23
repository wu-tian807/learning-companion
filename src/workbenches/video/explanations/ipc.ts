import { BrowserWindow, ipcMain } from 'electron';

import { AppError } from '../../../main/errors/app-error';
import { registerIpcHandler } from '../../../main/ipc/register-handler';
import type { VideoExplanationServiceApi } from './video-explanation-service';
import {
  VIDEO_EXPLANATION_IPC_CHANNELS,
  isListVideoExplanationsRequest,
  isVideoExplanationIdRequest,
} from './shared';

let removeSubscription: (() => void) | undefined;

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerVideoExplanationHandlers(
  service: VideoExplanationServiceApi,
): void {
  removeSubscription?.();
  removeSubscription = service.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(VIDEO_EXPLANATION_IPC_CHANNELS.changed, event);
      }
    }
  });

  registerIpcHandler(
    VIDEO_EXPLANATION_IPC_CHANNELS.list,
    (_event, request: unknown) => {
      if (!isListVideoExplanationsRequest(request)) throw invalidRequest();
      return service.list(request);
    },
  );
  registerIpcHandler(
    VIDEO_EXPLANATION_IPC_CHANNELS.retry,
    (_event, request: unknown) => {
      if (!isVideoExplanationIdRequest(request)) throw invalidRequest();
      return service.retry(request);
    },
  );
  registerIpcHandler(
    VIDEO_EXPLANATION_IPC_CHANNELS.delete,
    (_event, request: unknown) => {
      if (!isVideoExplanationIdRequest(request)) throw invalidRequest();
      return service.delete(request);
    },
  );
}

export function removeVideoExplanationHandlers(): void {
  removeSubscription?.();
  removeSubscription = undefined;
  ipcMain.removeHandler(VIDEO_EXPLANATION_IPC_CHANNELS.list);
  ipcMain.removeHandler(VIDEO_EXPLANATION_IPC_CHANNELS.retry);
  ipcMain.removeHandler(VIDEO_EXPLANATION_IPC_CHANNELS.delete);
}
