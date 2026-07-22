import { contextBridge, ipcRenderer } from 'electron';

import type { HealthCheckResponse, LearningCompanionApi } from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipc';

const api: LearningCompanionApi = {
  healthCheck: () =>
    ipcRenderer.invoke(IPC_CHANNELS.healthCheck) as Promise<HealthCheckResponse>,
};

contextBridge.exposeInMainWorld('learningCompanion', api);
