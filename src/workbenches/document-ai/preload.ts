import type { IpcRenderer } from 'electron';

import type { WorkbenchFeatureIpcInvoke } from '../epub/explanations/preload';
import {
  DOCUMENT_AI_IPC_CHANNELS,
  type DocumentAiPreloadApi,
  type DocumentAiRequest,
  type DocumentAiResponse,
} from './shared';

export function createDocumentAiPreloadApi(
  _ipcRenderer: IpcRenderer,
  invoke: WorkbenchFeatureIpcInvoke,
): DocumentAiPreloadApi {
  return Object.freeze({
    askDocumentAi: (request: DocumentAiRequest) =>
      invoke<DocumentAiResponse>(DOCUMENT_AI_IPC_CHANNELS.ask, request),
  });
}
