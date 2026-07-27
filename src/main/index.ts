import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import type { DatabaseContext } from './database/database-context';
import { initializeDatabase } from './database/initialize-database';
import { AssetDatabase } from './assets/asset-database';
import { AssetFileService } from './assets/asset-file-service';
import { AssetService } from './assets/asset-service';
import { EmptyAttachmentService } from './attachments/attachment-service';
import { ContentResolverRegistry } from './content/content-resolver-registry';
import { LocalFileContentResolver } from './content/resolvers/local-file/local-file-content-resolver';
import { registerHealthCheckHandler, removeHealthCheckHandler } from './ipc/health-check';
import { registerAssetHandlers, removeAssetHandlers } from './ipc/assets';
import { registerProjectHandlers, removeProjectHandlers } from './ipc/projects';
import { registerSettingsHandlers, removeSettingsHandlers } from './ipc/settings';
import {
  registerWorkbenchHandlers,
  removeWorkbenchHandlers,
} from './ipc/workbench';
import { createAppPaths } from './paths/app-paths';
import { ProjectDatabase } from './projects/project-database';
import { ProjectService } from './projects/project-service';
import { JsonSettingsRepository } from './settings/json-settings-repository';
import { WorkbenchRegistry } from './workbench/workbench-registry';
import { WorkbenchSessionManager } from './workbench/workbench-session-manager';
import { EmptyWorkbenchStateRepository } from './workbench/workbench-state-repository';
import { createMainWindow } from './window';
import { UnsupportedWorkbenchProvider } from '../workbenches/unsupported/main';

let databaseContext: DatabaseContext | undefined;

if (started) {
  app.quit();
}

void app.whenReady().then(async () => {
  const appPaths = createAppPaths(app.getPath('userData'));
  const settingsRepository = new JsonSettingsRepository(appPaths.settingsFile);
  databaseContext = initializeDatabase(appPaths.databaseFile);
  const projectDatabase = new ProjectDatabase(databaseContext);
  const assetDatabase = new AssetDatabase(databaseContext, projectDatabase);
  const contentResolverRegistry = new ContentResolverRegistry();
  contentResolverRegistry.register(new LocalFileContentResolver());
  const assetService = new AssetService(
    assetDatabase,
    contentResolverRegistry,
  );
  const assetFileService = new AssetFileService(assetService);
  const workbenchRegistry = new WorkbenchRegistry(
    new UnsupportedWorkbenchProvider(),
  );
  const workbenchSessionManager = new WorkbenchSessionManager(
    assetService,
    workbenchRegistry,
    new EmptyAttachmentService(),
    new EmptyWorkbenchStateRepository(),
  );
  const projectService = new ProjectService(
    projectDatabase,
    assetService,
    workbenchSessionManager,
  );

  await settingsRepository.initialize();
  projectDatabase.initialize();

  registerHealthCheckHandler();
  registerSettingsHandlers(settingsRepository);
  registerProjectHandlers(projectService);
  registerAssetHandlers(assetService, assetFileService);
  registerWorkbenchHandlers(workbenchSessionManager);
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
  removeAssetHandlers();
  removeWorkbenchHandlers();
  removeSettingsHandlers();
  removeProjectHandlers();
  databaseContext?.close();
  databaseContext = undefined;
});
