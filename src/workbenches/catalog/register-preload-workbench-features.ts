import type { IpcRenderer } from 'electron';

import {
  createEpubExplanationPreloadApi,
  type WorkbenchFeatureIpcInvoke,
} from '../epub/explanations/preload';
import type { EpubExplanationPreloadApi } from '../epub/explanations/shared';
import { createDocumentAiPreloadApi } from '../document-ai/preload';
import type { DocumentAiPreloadApi } from '../document-ai/shared';

export type WorkbenchFeaturePreloadApi =
  EpubExplanationPreloadApi & DocumentAiPreloadApi;

export function createPreloadWorkbenchFeatureApi(
  ipcRenderer: IpcRenderer,
  invoke: WorkbenchFeatureIpcInvoke,
): WorkbenchFeaturePreloadApi {
  return Object.freeze({
    ...createEpubExplanationPreloadApi(ipcRenderer, invoke),
    ...createDocumentAiPreloadApi(ipcRenderer, invoke),
  });
}
