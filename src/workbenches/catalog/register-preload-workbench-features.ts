import type { IpcRenderer } from 'electron';

import {
  createEpubExplanationPreloadApi,
  type WorkbenchFeatureIpcInvoke,
} from '../epub/explanations/preload';
import type { EpubExplanationPreloadApi } from '../epub/explanations/shared';
import { createImageExplanationPreloadApi } from '../image/explanations/preload';
import type { ImageExplanationPreloadApi } from '../image/explanations/shared';

export type WorkbenchFeaturePreloadApi =
  & EpubExplanationPreloadApi
  & ImageExplanationPreloadApi;

export function createPreloadWorkbenchFeatureApi(
  ipcRenderer: IpcRenderer,
  invoke: WorkbenchFeatureIpcInvoke,
): WorkbenchFeaturePreloadApi {
  return Object.freeze({
    ...createEpubExplanationPreloadApi(ipcRenderer, invoke),
    ...createImageExplanationPreloadApi(ipcRenderer, invoke),
  });
}
