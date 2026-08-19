import { emptyWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { mindMapWorkbenchManifest } from './shared';

export const mindMapPreloadWorkbenchContribution =
  emptyWorkbenchPreloadContribution(mindMapWorkbenchManifest.id);
