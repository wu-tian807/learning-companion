import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import {
  isProjectLearningNoteProjectRequest,
  isSaveProjectLearningNoteRequest,
} from '../../shared/project-learning-notes';
import type { ProjectLearningNoteServiceApi } from '../project-learning-notes/project-learning-note-service';
import type { ProjectNotebookAssetServiceApi } from '../project-notebook-assets/project-notebook-asset-service';
import { AppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

function invalidRequest(): AppError {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerProjectLearningNoteHandlers(
  service: ProjectLearningNoteServiceApi,
  notebooks?: Pick<ProjectNotebookAssetServiceApi, 'isLegacyWriteRetired'>,
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
      if (notebooks?.isLegacyWriteRetired(request.projectId)) {
        // Reads remain for recovery compatibility; writes would reintroduce
        // the retired DB body alongside its Markdown Asset.
        throw new AppError('FEATURE_NOT_SUPPORTED');
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
