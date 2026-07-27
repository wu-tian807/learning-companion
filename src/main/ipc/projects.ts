import { ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  isCreateProjectRequest,
  isDeleteProjectRequest,
  isRenameProjectRequest,
  isSetProjectPinnedRequest,
  type ProjectSummary,
} from '../../shared/ipc';
import type { ProjectDatabaseApi } from '../projects/project-database';
import type {
  ProjectOverview,
  ProjectServiceApi,
} from '../projects/project-service';
import { AppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

function toProjectSummary({
  project,
  assetCount,
}: ProjectOverview): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    icon: project.icon,
    createdTime: new Date(project.createdTime).toISOString(),
    assetCount,
    pinned: project.pinned,
  };
}

function requireProjectOverview(
  projectService: ProjectServiceApi,
  projectId: string,
): ProjectOverview {
  const overview = projectService.getProjectOverview(projectId);

  if (!overview) {
    throw new AppError('PROJECT_NOT_FOUND');
  }

  return overview;
}

export function registerProjectHandlers(
  database: ProjectDatabaseApi,
  projectService: ProjectServiceApi,
): void {
  registerIpcHandler(IPC_CHANNELS.listProjects, () =>
    projectService.listProjectOverviews().map(toProjectSummary),
  );

  registerIpcHandler(IPC_CHANNELS.createProject, (_event, request: unknown) => {
    if (!isCreateProjectRequest(request)) {
      throw invalidRequest();
    }

    const project = database.add(request);
    return toProjectSummary(requireProjectOverview(projectService, project.id));
  });

  registerIpcHandler(IPC_CHANNELS.renameProject, (_event, request: unknown) => {
    if (!isRenameProjectRequest(request)) {
      throw invalidRequest();
    }

    const project = database.update(request.id, { name: request.name });
    return toProjectSummary(requireProjectOverview(projectService, project.id));
  });

  registerIpcHandler(IPC_CHANNELS.setProjectPinned, (_event, request: unknown) => {
    if (!isSetProjectPinnedRequest(request)) {
      throw invalidRequest();
    }

    const project = database.update(request.id, { pinned: request.pinned });
    return toProjectSummary(requireProjectOverview(projectService, project.id));
  });

  registerIpcHandler(IPC_CHANNELS.deleteProject, async (_event, request: unknown) => {
    if (!isDeleteProjectRequest(request)) {
      throw invalidRequest();
    }

    await projectService.deleteProjectCascade(request.id);
  });
}

export function removeProjectHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.listProjects);
  ipcMain.removeHandler(IPC_CHANNELS.createProject);
  ipcMain.removeHandler(IPC_CHANNELS.renameProject);
  ipcMain.removeHandler(IPC_CHANNELS.setProjectPinned);
  ipcMain.removeHandler(IPC_CHANNELS.deleteProject);
}
