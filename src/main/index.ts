import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { registerHealthCheckHandler, removeHealthCheckHandler } from './ipc/health-check';
import { createMainWindow } from './window';

if (started) {
  app.quit();
}

void app.whenReady().then(() => {
  registerHealthCheckHandler();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  removeHealthCheckHandler();
});
