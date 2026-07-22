import { app, ipcMain } from 'electron';

import { createHealthCheckResponse, IPC_CHANNELS } from '../../shared/ipc';

export function registerHealthCheckHandler(): void {
  ipcMain.handle(IPC_CHANNELS.healthCheck, () =>
    createHealthCheckResponse(app.getVersion(), process.platform),
  );
}

export function removeHealthCheckHandler(): void {
  ipcMain.removeHandler(IPC_CHANNELS.healthCheck);
}
