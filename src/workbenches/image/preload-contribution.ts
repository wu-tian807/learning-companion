import { defineWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { createImageExplanationPreloadApi } from './explanations/preload';
import { imageWorkbenchManifest } from './shared';

export const imagePreloadWorkbenchContribution =
  defineWorkbenchPreloadContribution({
    id: imageWorkbenchManifest.id,
    createApi: ({ ipcRenderer, invoke }) =>
      createImageExplanationPreloadApi(ipcRenderer, invoke),
  });
