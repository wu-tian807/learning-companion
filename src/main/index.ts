import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import type { DatabaseContext } from './database/database-context';
import { initializeDatabase } from './database/initialize-database';
import { registerHealthCheckHandler, removeHealthCheckHandler } from './ipc/health-check';
import { registerProjectHandlers, removeProjectHandlers } from './ipc/projects';
import { registerSettingsHandlers, removeSettingsHandlers } from './ipc/settings';
import { createAppPaths } from './paths/app-paths';
import { ProjectDatabase } from './projects/project-database';
import { JsonSettingsRepository } from './settings/json-settings-repository';
import { createMainWindow } from './window';

let databaseContext: DatabaseContext | undefined;

if (started) {
  app.quit();
}

void app.whenReady().then(async () => {
  const appPaths = createAppPaths(app.getPath('userData'));
  const settingsRepository = new JsonSettingsRepository(appPaths.settingsFile);
  databaseContext = initializeDatabase(appPaths.databaseFile);
  const projectDatabase = new ProjectDatabase(databaseContext);

  await settingsRepository.initialize();
  projectDatabase.initialize();

  registerHealthCheckHandler();
  registerSettingsHandlers(settingsRepository);
  registerProjectHandlers(projectDatabase);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((error: unknown) => {
  console.error('应用初始化失败', error);
  databaseContext?.close();
  databaseContext = undefined;
  app.quit();
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
  databaseContext?.close();
  databaseContext = undefined;
});
