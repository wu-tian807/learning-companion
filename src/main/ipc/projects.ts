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

function invalidRequest(operation: string): Error {
  return new Error(`Project ${operation}请求无效`);
}

function toProjectSummary({
  project,
  assetCount,
}: ProjectOverview): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    icon: project.icon,
    createdTime: project.createdTime.toISOString(),
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
    throw new Error('找不到指定的 Project');
  }

  return overview;
}

export function registerProjectHandlers(
  database: ProjectDatabaseApi,
  projectService: ProjectServiceApi,
): void {
  ipcMain.handle(IPC_CHANNELS.listProjects, () =>
    projectService.listProjectOverviews().map(toProjectSummary),
  );

  ipcMain.handle(IPC_CHANNELS.createProject, (_event, request: unknown) => {
    if (!isCreateProjectRequest(request)) {
      throw invalidRequest('创建');
    }

    const project = database.add(request);
    return toProjectSummary(requireProjectOverview(projectService, project.id));
  });

  ipcMain.handle(IPC_CHANNELS.renameProject, (_event, request: unknown) => {
    if (!isRenameProjectRequest(request)) {
      throw invalidRequest('重命名');
    }

    const project = database.update(request.id, { name: request.name });
    return toProjectSummary(requireProjectOverview(projectService, project.id));
  });

  ipcMain.handle(IPC_CHANNELS.setProjectPinned, (_event, request: unknown) => {
    if (!isSetProjectPinnedRequest(request)) {
      throw invalidRequest('置顶');
    }

    const project = database.update(request.id, { pinned: request.pinned });
    return toProjectSummary(requireProjectOverview(projectService, project.id));
  });

  ipcMain.handle(IPC_CHANNELS.deleteProject, (_event, request: unknown) => {
    if (!isDeleteProjectRequest(request)) {
      throw invalidRequest('删除');
    }

    projectService.deleteProjectCascade(request.id);
  });
}

export function removeProjectHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.listProjects);
  ipcMain.removeHandler(IPC_CHANNELS.createProject);
  ipcMain.removeHandler(IPC_CHANNELS.renameProject);
  ipcMain.removeHandler(IPC_CHANNELS.setProjectPinned);
  ipcMain.removeHandler(IPC_CHANNELS.deleteProject);
}
