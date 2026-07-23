import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { ProjectRepository } from '../projects/project-repository';

export function registerProjectHandlers(repository: ProjectRepository): void {
  ipcMain.handle(IPC_CHANNELS.listProjects, () =>
    repository.list().map((project) => project.toSummary()),
  );
}

export function removeProjectHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.listProjects);
}
