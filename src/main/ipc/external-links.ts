import { ipcMain, shell } from 'electron';

import {
  IPC_CHANNELS,
  isOpenExternalRequest,
} from '../../shared/ipc';
import { AppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

export function registerExternalLinkHandler(): void {
  registerIpcHandler(
    IPC_CHANNELS.openExternal,
    async (_event, request: unknown) => {
      if (!isOpenExternalRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }

      await shell.openExternal(new URL(request.url).href);
    },
  );
}

export function removeExternalLinkHandler(): void {
  ipcMain.removeHandler(IPC_CHANNELS.openExternal);
}
