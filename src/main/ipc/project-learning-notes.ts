import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import {
  isProjectLearningNoteProjectRequest,
  isSaveProjectLearningNoteRequest,
} from '../../shared/project-learning-notes';
import type { ProjectLearningNoteServiceApi } from '../project-learning-notes/project-learning-note-service';
import { AppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

function invalidRequest(): AppError {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerProjectLearningNoteHandlers(
  service: ProjectLearningNoteServiceApi,
): void {
  registerIpcHandler(
    IPC_CHANNELS.getProjectLearningNote,
    async (_event, request: unknown) => {
      if (!isProjectLearningNoteProjectRequest(request)) {
        throw invalidRequest();
      }
      return service.get(request.projectId);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.saveProjectLearningNote,
    async (_event, request: unknown) => {
      if (!isSaveProjectLearningNoteRequest(request)) {
        throw invalidRequest();
      }
      return service.save(
        request.projectId,
        request.markdown,
        request.expectedRevision,
      );
    },
  );
}

export function removeProjectLearningNoteHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.getProjectLearningNote);
  ipcMain.removeHandler(IPC_CHANNELS.saveProjectLearningNote);
}
