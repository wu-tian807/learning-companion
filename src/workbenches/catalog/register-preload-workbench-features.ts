import type { IpcRenderer } from 'electron';

import {
  composeWorkbenchPreloadApi,
  type ComposedWorkbenchPreloadApi,
  type WorkbenchFeatureIpcInvoke,
} from '../../preload/workbench-preload-contribution';
import { audioPreloadWorkbenchContribution } from '../audio/preload-contribution';
import { epubPreloadWorkbenchContribution } from '../epub/preload-contribution';
import { htmlPreloadWorkbenchContribution } from '../html/preload-contribution';
import { imagePreloadWorkbenchContribution } from '../image/preload-contribution';
import { markdownPreloadWorkbenchContribution } from '../markdown/preload-contribution';
import { mindMapPreloadWorkbenchContribution } from '../mindmap/preload-contribution';
import { officePreloadWorkbenchContribution } from '../office/preload-contribution';
import { pdfPreloadWorkbenchContribution } from '../pdf/preload-contribution';
import { plainTextPreloadWorkbenchContribution } from '../plain-text/preload-contribution';
import { videoPreloadWorkbenchContribution } from '../video/preload-contribution';

export const preloadWorkbenchContributions = Object.freeze([
  plainTextPreloadWorkbenchContribution,
  markdownPreloadWorkbenchContribution,
  mindMapPreloadWorkbenchContribution,
  pdfPreloadWorkbenchContribution,
  officePreloadWorkbenchContribution,
  htmlPreloadWorkbenchContribution,
  epubPreloadWorkbenchContribution,
  imagePreloadWorkbenchContribution,
  audioPreloadWorkbenchContribution,
  videoPreloadWorkbenchContribution,
] as const);

export type WorkbenchFeaturePreloadApi = ComposedWorkbenchPreloadApi<
  typeof preloadWorkbenchContributions
>;

export function createPreloadWorkbenchFeatureApi(
  ipcRenderer: IpcRenderer,
  invoke: WorkbenchFeatureIpcInvoke,
): WorkbenchFeaturePreloadApi {
  return composeWorkbenchPreloadApi(preloadWorkbenchContributions, {
    ipcRenderer,
    invoke,
  });
}
