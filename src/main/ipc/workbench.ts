import { BrowserWindow, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import {
  isWorkbenchCloseRequest,
  isWorkbenchCommandRequest,
  isWorkbenchOpenRequest,
} from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';
import type { WorkbenchSessionServiceApi } from '../workbench/workbench-session-service';
import type { WorkbenchEventBusApi } from '../workbench/workbench-event-bus';
import { registerIpcHandler } from './register-handler';

let removeEventSubscription: (() => void) | undefined;

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerWorkbenchHandlers(
  service: WorkbenchSessionServiceApi,
  events: WorkbenchEventBusApi,
): void {
  removeEventSubscription?.();
  removeEventSubscription = events.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.workbenchEvent, event);
      }
    }
  });
  registerIpcHandler(
    IPC_CHANNELS.openWorkbench,
    async (_event, request: unknown) => {
      if (!isWorkbenchOpenRequest(request)) {
        throw invalidRequest();
      }

      return service.open(request.assetId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.commandWorkbench,
    async (_event, request: unknown) => {
      if (!isWorkbenchCommandRequest(request)) {
        throw invalidRequest();
      }

      return service.command(request.sessionId, request.command);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.closeWorkbench,
    async (_event, request: unknown) => {
      if (!isWorkbenchCloseRequest(request)) {
        throw invalidRequest();
      }

      await service.close(request.sessionId);
    },
  );
}

export function removeWorkbenchHandlers(): void {
  removeEventSubscription?.();
  removeEventSubscription = undefined;
  ipcMain.removeHandler(IPC_CHANNELS.openWorkbench);
  ipcMain.removeHandler(IPC_CHANNELS.commandWorkbench);
  ipcMain.removeHandler(IPC_CHANNELS.closeWorkbench);
}
