import { emptyWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { htmlWorkbenchManifest } from './shared';

export const htmlPreloadWorkbenchContribution =
  emptyWorkbenchPreloadContribution(htmlWorkbenchManifest.id);
