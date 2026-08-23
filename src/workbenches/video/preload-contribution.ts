import { defineWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { createVideoExplanationPreloadApi } from './explanations/preload';
import { videoWorkbenchManifest } from './shared';

export const videoPreloadWorkbenchContribution =
  defineWorkbenchPreloadContribution({
    id: videoWorkbenchManifest.id,
    createApi: ({ ipcRenderer, invoke }) =>
      createVideoExplanationPreloadApi(ipcRenderer, invoke),
  });
