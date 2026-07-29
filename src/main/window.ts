import { BrowserWindow } from 'electron';
import path from 'node:path';

import { isAllowedMainWindowNavigation } from './navigation-policy';
import type { SandboxFrameInteractionBridge } from './workbench/interaction/sandbox-frame-interaction-bridge';

export function createMainWindow(
  interactionBridge?: Pick<
    SandboxFrameInteractionBridge,
    'attach'
  >,
): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0d12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const guardNavigation = (event: {
    readonly url: string;
    preventDefault(): void;
  }) => {
    const allowed = isAllowedMainWindowNavigation(
      mainWindow.webContents.getURL(),
      event.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
    );

    if (!allowed) {
      event.preventDefault();
    }
  };

  mainWindow.webContents.on('will-navigate', guardNavigation);
  mainWindow.webContents.on('will-redirect', guardNavigation);
  const detachInteractionBridge = interactionBridge?.attach(
    mainWindow.webContents,
  );
  mainWindow.once('closed', () => {
    detachInteractionBridge?.();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return mainWindow;
}
