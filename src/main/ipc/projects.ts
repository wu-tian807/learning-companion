import { ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  isCreateProjectRequest,
  isDeleteProjectRequest,
  isRenameProjectRequest,
  isSetProjectPinnedRequest,
} from '../../shared/ipc';
import type { ProjectServiceApi } from '../projects/project-service';
import { AppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerProjectHandlers(
  projectService: ProjectServiceApi,
): void {
  registerIpcHandler(IPC_CHANNELS.listProjects, () =>
    projectService.listProjects(),
  );

  registerIpcHandler(IPC_CHANNELS.createProject, (_event, request: unknown) => {
    if (!isCreateProjectRequest(request)) {
      throw invalidRequest();
    }

    return projectService.createProject(request);
  });

  registerIpcHandler(IPC_CHANNELS.renameProject, (_event, request: unknown) => {
    if (!isRenameProjectRequest(request)) {
      throw invalidRequest();
    }

    return projectService.renameProject(request.id, request.name);
  });

  registerIpcHandler(IPC_CHANNELS.setProjectPinned, (_event, request: unknown) => {
    if (!isSetProjectPinnedRequest(request)) {
      throw invalidRequest();
    }

    return projectService.setProjectPinned(request.id, request.pinned);
  });

  registerIpcHandler(IPC_CHANNELS.deleteProject, async (_event, request: unknown) => {
    if (!isDeleteProjectRequest(request)) {
      throw invalidRequest();
    }

    await projectService.deleteProject(request.id);
  });
}

export function removeProjectHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.listProjects);
  ipcMain.removeHandler(IPC_CHANNELS.createProject);
  ipcMain.removeHandler(IPC_CHANNELS.renameProject);
  ipcMain.removeHandler(IPC_CHANNELS.setProjectPinned);
  ipcMain.removeHandler(IPC_CHANNELS.deleteProject);
}
