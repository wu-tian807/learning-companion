import { defineWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { createEpubExplanationPreloadApi } from './explanations/preload';
import { epubWorkbenchManifest } from './shared';

export const epubPreloadWorkbenchContribution =
  defineWorkbenchPreloadContribution({
    id: epubWorkbenchManifest.id,
    createApi: ({ ipcRenderer, invoke }) =>
      createEpubExplanationPreloadApi(ipcRenderer, invoke),
  });
