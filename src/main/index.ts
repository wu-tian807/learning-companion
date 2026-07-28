import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import type { DatabaseContext } from './database/database-context';
import { initializeDatabase } from './database/initialize-database';
import { AssetDatabase } from './assets/asset-database';
import { AssetShellService } from './assets/asset-shell-service';
import { AssetService } from './assets/asset-service';
import { EmptyAttachmentService } from './attachments/attachment-service';
import { ContentResolverRegistry } from './content/content-resolver-registry';
import { ContentResourceService } from './content/content-resource-service';
import {
  registerContentProtocol,
  registerContentSchemePrivileges,
  removeContentProtocol,
} from './content/register-content-protocol';
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
import { SqliteWorkbenchStateDataRepository } from './workbench/workbench-state-data-repository';
import { SqliteWorkbenchStateRepository } from './workbench/workbench-state-repository';
import { createMainWindow } from './window';
import { PlainTextWorkbenchProvider } from '../workbenches/plain-text/main';
import { ImageWorkbenchProvider } from '../workbenches/image/main';
import { UnsupportedWorkbenchProvider } from '../workbenches/unsupported/main';

let databaseContext: DatabaseContext | undefined;
let contentResourceService: ContentResourceService | undefined;

registerContentSchemePrivileges();

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
  contentResourceService = new ContentResourceService();
  registerContentProtocol(contentResourceService);
  const assetService = new AssetService(
    assetDatabase,
    contentResolverRegistry,
  );
  const assetShellService = new AssetShellService(assetService);
  const workbenchRegistry = new WorkbenchRegistry(
    new UnsupportedWorkbenchProvider(),
  );
  const workbenchStateRepository = new SqliteWorkbenchStateRepository(
    databaseContext,
  );
  const workbenchStateDataRepository =
    new SqliteWorkbenchStateDataRepository(databaseContext);
  workbenchRegistry.register(
    new PlainTextWorkbenchProvider(
      workbenchStateRepository,
      workbenchStateDataRepository,
    ),
  );
  workbenchRegistry.register(
    new ImageWorkbenchProvider(
      contentResourceService,
      workbenchStateRepository,
    ),
  );
  const workbenchSessionManager = new WorkbenchSessionManager(
    assetService,
    workbenchRegistry,
    new EmptyAttachmentService(),
    workbenchStateRepository,
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
  registerAssetHandlers(assetService, assetShellService);
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
  removeContentProtocol();
  contentResourceService?.dispose();
  contentResourceService = undefined;
  removeHealthCheckHandler();
  removeAssetHandlers();
  removeWorkbenchHandlers();
  removeSettingsHandlers();
  removeProjectHandlers();
  databaseContext?.close();
  databaseContext = undefined;
});
