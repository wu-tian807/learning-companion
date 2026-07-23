import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { registerHealthCheckHandler, removeHealthCheckHandler } from './ipc/health-check';
import { registerProjectHandlers, removeProjectHandlers } from './ipc/projects';
import { registerSettingsHandlers, removeSettingsHandlers } from './ipc/settings';
import { createAppPaths } from './paths/app-paths';
import { createDefaultProjectRepository } from './projects/in-memory-project-repository';
import { JsonSettingsRepository } from './settings/json-settings-repository';
import { createMainWindow } from './window';

if (started) {
  app.quit();
}

void app.whenReady().then(async () => {
  const appPaths = createAppPaths(app.getPath('userData'));
  const settingsRepository = new JsonSettingsRepository(appPaths.settingsFile);
  const projectRepository = createDefaultProjectRepository();

  await settingsRepository.initialize();

  registerHealthCheckHandler();
  registerSettingsHandlers(settingsRepository);
  registerProjectHandlers(projectRepository);
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
  removeSettingsHandlers();
  removeProjectHandlers();
});
