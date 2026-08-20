import { emptyWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { plainTextWorkbenchManifest } from './shared';

export const plainTextPreloadWorkbenchContribution =
  emptyWorkbenchPreloadContribution(plainTextWorkbenchManifest.id);
