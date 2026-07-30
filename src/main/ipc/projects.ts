import { ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  isChangeProjectWorkspaceRequest,
  isCreateProjectRequest,
  isDeleteProjectRequest,
  isProjectLifecycleRequest,
  isRenameProjectRequest,
  isSelectProjectWorkspaceRequest,
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

  registerIpcHandler(
    IPC_CHANNELS.openProject,
    async (_event, request: unknown) => {
      if (!isProjectLifecycleRequest(request)) {
        throw invalidRequest();
      }

      return projectService.openProject(request.projectId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.closeProject,
    async (_event, request: unknown) => {
      if (!isProjectLifecycleRequest(request)) {
        throw invalidRequest();
      }

      await projectService.closeProject(request.projectId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.createProject,
    async (_event, request: unknown) => {
      if (!isCreateProjectRequest(request)) {
        throw invalidRequest();
      }

      return projectService.createProject(request);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.selectProjectWorkspace,
    async (_event, request: unknown) => {
      if (!isSelectProjectWorkspaceRequest(request)) {
        throw invalidRequest();
      }

      return projectService.selectProjectWorkspace(request.projectId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.changeProjectWorkspace,
    async (_event, request: unknown) => {
      if (!isChangeProjectWorkspaceRequest(request)) {
        throw invalidRequest();
      }

      return projectService.changeProjectWorkspace(
        request.projectId,
        request.workspacePath,
      );
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.openProjectWorkspace,
    async (_event, request: unknown) => {
      if (!isProjectLifecycleRequest(request)) {
        throw invalidRequest();
      }

      await projectService.openProjectWorkspace(request.projectId);
    },
  );

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
  ipcMain.removeHandler(IPC_CHANNELS.openProject);
  ipcMain.removeHandler(IPC_CHANNELS.closeProject);
  ipcMain.removeHandler(IPC_CHANNELS.createProject);
  ipcMain.removeHandler(IPC_CHANNELS.selectProjectWorkspace);
  ipcMain.removeHandler(IPC_CHANNELS.changeProjectWorkspace);
  ipcMain.removeHandler(IPC_CHANNELS.openProjectWorkspace);
  ipcMain.removeHandler(IPC_CHANNELS.renameProject);
  ipcMain.removeHandler(IPC_CHANNELS.setProjectPinned);
  ipcMain.removeHandler(IPC_CHANNELS.deleteProject);
}
