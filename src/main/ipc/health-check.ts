import { app, ipcMain } from 'electron';

import { createHealthCheckResponse, IPC_CHANNELS } from '../../shared/ipc';
import { registerIpcHandler } from './register-handler';

export function registerHealthCheckHandler(): void {
  registerIpcHandler(IPC_CHANNELS.healthCheck, () =>
    createHealthCheckResponse(app.getVersion(), process.platform),
  );
}

export function removeHealthCheckHandler(): void {
  ipcMain.removeHandler(IPC_CHANNELS.healthCheck);
}
