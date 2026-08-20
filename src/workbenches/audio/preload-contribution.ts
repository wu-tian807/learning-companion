import { emptyWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { audioWorkbenchManifest } from './shared';

export const audioPreloadWorkbenchContribution =
  emptyWorkbenchPreloadContribution(audioWorkbenchManifest.id);
