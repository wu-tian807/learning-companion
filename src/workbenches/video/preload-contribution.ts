import { emptyWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { videoWorkbenchManifest } from './shared';

export const videoPreloadWorkbenchContribution =
  emptyWorkbenchPreloadContribution(videoWorkbenchManifest.id);
