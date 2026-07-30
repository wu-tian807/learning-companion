import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import type { ApplicationRuntime } from './bootstrap/application-runtime';
import { createApplicationRuntime } from './bootstrap/create-application-runtime';
import { registerContentSchemePrivileges } from './content/register-content-protocol';
import { createMainWindow } from './window';

let runtime: ApplicationRuntime | undefined;
let quitCleanupComplete = false;
let quitCleanupStarted = false;

function createManagedMainWindow(): void {
  const mainWindow = createMainWindow(runtime?.interactionBridge);

  mainWindow.on('closed', () => {
    void runtime?.closeActiveWorkbench().catch((error: unknown) => {
      console.error('关闭窗口时释放资料工作台失败', error);
    });
  });
}

registerContentSchemePrivileges();

if (started) {
  app.quit();
}

void app
  .whenReady()
  .then(async () => {
    runtime = await createApplicationRuntime({
      userDataPath: app.getPath('userData'),
      documentsPath: app.getPath('documents'),
    });
    createManagedMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createManagedMainWindow();
      }
    });
  })
  .catch(async (error: unknown) => {
    console.error('应用初始化失败', error);
    await runtime?.shutdown().catch((closeError: unknown) => {
      console.error('初始化失败后的应用服务清理失败', closeError);
    });
    runtime?.dispose();
    runtime = undefined;
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (quitCleanupComplete || quitCleanupStarted) {
    return;
  }

  event.preventDefault();
  quitCleanupStarted = true;
  void (runtime?.shutdown() ?? Promise.resolve())
    .catch((error: unknown) => {
      console.error('应用退出前清理服务失败', error);
    })
    .finally(() => {
      quitCleanupComplete = true;
      quitCleanupStarted = false;
      app.quit();
    });
});

app.on('will-quit', () => {
  runtime?.dispose();
  runtime = undefined;
});
