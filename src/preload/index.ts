import { contextBridge, ipcRenderer } from 'electron';

import type {
  CreateProjectRequest,
  DeleteProjectRequest,
  HealthCheckResponse,
  LearningCompanionApi,
  ProjectSummary,
  RenameProjectRequest,
  SetProjectPinnedRequest,
} from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipc';

const api: LearningCompanionApi = {
  healthCheck: () =>
    ipcRenderer.invoke(IPC_CHANNELS.healthCheck) as Promise<HealthCheckResponse>,
  listProjects: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listProjects) as Promise<ProjectSummary[]>,
  createProject: (request: CreateProjectRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.createProject, request) as Promise<ProjectSummary>,
  renameProject: (request: RenameProjectRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameProject, request) as Promise<ProjectSummary>,
  setProjectPinned: (request: SetProjectPinnedRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProjectPinned, request) as Promise<ProjectSummary>,
  deleteProject: (request: DeleteProjectRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteProject, request) as Promise<void>,
};

contextBridge.exposeInMainWorld('learningCompanion', api);
