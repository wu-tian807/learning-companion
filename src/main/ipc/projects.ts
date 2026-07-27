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
import type { Project } from '../projects/project';
import type { ProjectServiceApi } from '../projects/project-service';

function invalidRequest(operation: string): Error {
  return new Error(`Project ${operation}请求无效`);
}

function toProjectSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    icon: project.icon,
    createdTime: project.createdTime.toISOString(),
    sources: [],
    pinned: project.pinned,
  };
}

export function registerProjectHandlers(
  database: ProjectDatabaseApi,
  projectService: ProjectServiceApi,
): void {
  ipcMain.handle(IPC_CHANNELS.listProjects, () =>
    database.list().map(toProjectSummary),
  );

  ipcMain.handle(IPC_CHANNELS.createProject, (_event, request: unknown) => {
    if (!isCreateProjectRequest(request)) {
      throw invalidRequest('创建');
    }

    return toProjectSummary(database.add(request));
  });

  ipcMain.handle(IPC_CHANNELS.renameProject, (_event, request: unknown) => {
    if (!isRenameProjectRequest(request)) {
      throw invalidRequest('重命名');
    }

    return toProjectSummary(database.update(request.id, { name: request.name }));
  });

  ipcMain.handle(IPC_CHANNELS.setProjectPinned, (_event, request: unknown) => {
    if (!isSetProjectPinnedRequest(request)) {
      throw invalidRequest('置顶');
    }

    return toProjectSummary(
      database.update(request.id, { pinned: request.pinned }),
    );
  });

  ipcMain.handle(IPC_CHANNELS.deleteProject, (_event, request: unknown) => {
    if (!isDeleteProjectRequest(request)) {
      throw invalidRequest('删除');
    }

    projectService.deleteProject(request.id);
  });
}

export function removeProjectHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.listProjects);
  ipcMain.removeHandler(IPC_CHANNELS.createProject);
  ipcMain.removeHandler(IPC_CHANNELS.renameProject);
  ipcMain.removeHandler(IPC_CHANNELS.setProjectPinned);
  ipcMain.removeHandler(IPC_CHANNELS.deleteProject);
}
