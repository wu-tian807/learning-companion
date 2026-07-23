import { ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  isCreateProjectRequest,
  isDeleteProjectRequest,
  isRenameProjectRequest,
  isSetProjectPinnedRequest,
} from '../../shared/ipc';
import type { ProjectRepository } from '../projects/project-repository';

function invalidRequest(operation: string): Error {
  return new Error(`Project ${operation}请求无效`);
}

export function registerProjectHandlers(repository: ProjectRepository): void {
  ipcMain.handle(IPC_CHANNELS.listProjects, () =>
    repository.list().map((project) => project.toSummary()),
  );

  ipcMain.handle(IPC_CHANNELS.createProject, (_event, request: unknown) => {
    if (!isCreateProjectRequest(request)) {
      throw invalidRequest('创建');
    }

    return repository.create(request).toSummary();
  });

  ipcMain.handle(IPC_CHANNELS.renameProject, (_event, request: unknown) => {
    if (!isRenameProjectRequest(request)) {
      throw invalidRequest('重命名');
    }

    return repository.rename(request.id, request.name).toSummary();
  });

  ipcMain.handle(IPC_CHANNELS.setProjectPinned, (_event, request: unknown) => {
    if (!isSetProjectPinnedRequest(request)) {
      throw invalidRequest('置顶');
    }

    return repository.setPinned(request.id, request.pinned).toSummary();
  });

  ipcMain.handle(IPC_CHANNELS.deleteProject, (_event, request: unknown) => {
    if (!isDeleteProjectRequest(request)) {
      throw invalidRequest('删除');
    }

    repository.delete(request.id);
  });
}

export function removeProjectHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.listProjects);
  ipcMain.removeHandler(IPC_CHANNELS.createProject);
  ipcMain.removeHandler(IPC_CHANNELS.renameProject);
  ipcMain.removeHandler(IPC_CHANNELS.setProjectPinned);
  ipcMain.removeHandler(IPC_CHANNELS.deleteProject);
}
