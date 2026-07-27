import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import {
  isWorkbenchCloseRequest,
  isWorkbenchCommandRequest,
  isWorkbenchOpenRequest,
} from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';
import type { WorkbenchSessionManagerApi } from '../workbench/workbench-session-manager';
import { registerIpcHandler } from './register-handler';

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerWorkbenchHandlers(
  manager: WorkbenchSessionManagerApi,
): void {
  registerIpcHandler(
    IPC_CHANNELS.openWorkbench,
    async (_event, request: unknown) => {
      if (!isWorkbenchOpenRequest(request)) {
        throw invalidRequest();
      }

      return manager.open(request.assetId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.commandWorkbench,
    async (_event, request: unknown) => {
      if (!isWorkbenchCommandRequest(request)) {
        throw invalidRequest();
      }

      return manager.command(request.sessionId, request.command);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.closeWorkbench,
    async (_event, request: unknown) => {
      if (!isWorkbenchCloseRequest(request)) {
        throw invalidRequest();
      }

      await manager.close(request.sessionId);
    },
  );
}

export function removeWorkbenchHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.openWorkbench);
  ipcMain.removeHandler(IPC_CHANNELS.commandWorkbench);
  ipcMain.removeHandler(IPC_CHANNELS.closeWorkbench);
}
