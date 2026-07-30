import { BrowserWindow, dialog, ipcMain } from "electron";

import {
  IPC_CHANNELS,
  isExternalLibraryIdRequest,
  isMigrateExternalLibrariesRequest,
} from "../../shared/ipc";
import { AppError } from "../errors/app-error";
import type { ExternalLibraryServiceApi } from "../external-libraries/external-library-service";
import { registerIpcHandler } from "./register-handler";

let removeSubscription: (() => void) | undefined;

export interface ExternalLibraryHandlerDependencies {
  readonly broadcast: (channel: string, value: unknown) => void;
  readonly selectDirectory: () => Promise<string | undefined>;
}

const defaultDependencies: ExternalLibraryHandlerDependencies = {
  broadcast(channel, value) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, value);
      }
    }
  },
  async selectDirectory() {
    const result = await dialog.showOpenDialog({
      title: "选择外部组件存储位置",
      buttonLabel: "迁移到这里",
      properties: ["openDirectory", "createDirectory"],
    });

    return result.canceled ? undefined : result.filePaths[0];
  },
};

function requireRequest(value: unknown) {
  if (!isExternalLibraryIdRequest(value)) {
    throw new AppError("INVALID_IPC_REQUEST");
  }

  return value;
}

export function registerExternalLibraryHandlers(
  service: ExternalLibraryServiceApi,
  dependencies: ExternalLibraryHandlerDependencies = defaultDependencies,
): void {
  removeSubscription?.();
  removeSubscription = service.subscribe((snapshot) => {
    dependencies.broadcast(IPC_CHANNELS.externalLibraryChanged, snapshot);
  });

  registerIpcHandler(IPC_CHANNELS.listExternalLibraries, async () => {
    await service.initialize();
    return service.list();
  });
  registerIpcHandler(
    IPC_CHANNELS.refreshExternalLibrary,
    (_event, request: unknown) =>
      service.refresh(requireRequest(request).libraryId),
  );
  registerIpcHandler(
    IPC_CHANNELS.installExternalLibrary,
    (_event, request: unknown) =>
      service.install(requireRequest(request).libraryId),
  );
  registerIpcHandler(
    IPC_CHANNELS.cancelExternalLibrary,
    (_event, request: unknown) => {
      service.cancel(requireRequest(request).libraryId);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.removeExternalLibrary,
    (_event, request: unknown) =>
      service.remove(requireRequest(request).libraryId),
  );
  registerIpcHandler(
    IPC_CHANNELS.selectExternalLibrariesDirectory,
    () => dependencies.selectDirectory(),
  );
  registerIpcHandler(
    IPC_CHANNELS.migrateExternalLibraries,
    (_event, request: unknown) => {
      if (!isMigrateExternalLibrariesRequest(request)) {
        throw new AppError("INVALID_IPC_REQUEST");
      }

      return service.migrate(
        request.targetPath,
        request.conflictResolution,
      );
    },
  );
}

export function removeExternalLibraryHandlers(): void {
  removeSubscription?.();
  removeSubscription = undefined;
  ipcMain.removeHandler(IPC_CHANNELS.listExternalLibraries);
  ipcMain.removeHandler(IPC_CHANNELS.refreshExternalLibrary);
  ipcMain.removeHandler(IPC_CHANNELS.installExternalLibrary);
  ipcMain.removeHandler(IPC_CHANNELS.cancelExternalLibrary);
  ipcMain.removeHandler(IPC_CHANNELS.removeExternalLibrary);
  ipcMain.removeHandler(
    IPC_CHANNELS.selectExternalLibrariesDirectory,
  );
  ipcMain.removeHandler(IPC_CHANNELS.migrateExternalLibraries);
}
