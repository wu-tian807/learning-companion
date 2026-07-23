import { contextBridge, ipcRenderer } from 'electron';

import type {
  HealthCheckResponse,
  LearningCompanionApi,
  ProjectSummary,
} from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipc';

const api: LearningCompanionApi = {
  healthCheck: () =>
    ipcRenderer.invoke(IPC_CHANNELS.healthCheck) as Promise<HealthCheckResponse>,
  listProjects: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listProjects) as Promise<ProjectSummary[]>,
};

contextBridge.exposeInMainWorld('learningCompanion', api);
