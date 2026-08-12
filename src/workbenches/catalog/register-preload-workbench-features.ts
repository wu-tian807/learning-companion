import type { IpcRenderer } from 'electron';

import {
  createEpubExplanationPreloadApi,
  type WorkbenchFeatureIpcInvoke,
} from '../epub/explanations/preload';
import type { EpubExplanationPreloadApi } from '../epub/explanations/shared';

export type WorkbenchFeaturePreloadApi = EpubExplanationPreloadApi;

export function createPreloadWorkbenchFeatureApi(
  ipcRenderer: IpcRenderer,
  invoke: WorkbenchFeatureIpcInvoke,
): WorkbenchFeaturePreloadApi {
  return Object.freeze({
    ...createEpubExplanationPreloadApi(ipcRenderer, invoke),
  });
}
