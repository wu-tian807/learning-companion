import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import {
  isCreateProjectNotebookRequest,
  isProjectNotebookProjectRequest,
  isSelectProjectNotebookAssetRequest,
} from '../../shared/project-notebook-assets';
import type { ProjectNotebookAssetServiceApi } from '../project-notebook-assets/project-notebook-asset-service';
import { AppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

function invalidRequest(): AppError {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerProjectNotebookAssetHandlers(
  service: ProjectNotebookAssetServiceApi,
): void {
  registerIpcHandler(
    IPC_CHANNELS.getProjectNotebook,
    async (_event, request: unknown) => {
      if (!isProjectNotebookProjectRequest(request)) throw invalidRequest();
      return service.get(request.projectId);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.createProjectNotebook,
    async (_event, request: unknown) => {
      if (!isCreateProjectNotebookRequest(request)) throw invalidRequest();
      return service.create(request.projectId, request.name);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.selectProjectNotebookAsset,
    async (_event, request: unknown) => {
      if (!isSelectProjectNotebookAssetRequest(request)) {
        throw invalidRequest();
      }
      return service.select(request.projectId, request.assetId);
    },
  );
}

export function removeProjectNotebookAssetHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.getProjectNotebook);
  ipcMain.removeHandler(IPC_CHANNELS.createProjectNotebook);
  ipcMain.removeHandler(IPC_CHANNELS.selectProjectNotebookAsset);
}
