import { emptyWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { officeWorkbenchManifest } from './shared';

export const officePreloadWorkbenchContribution =
  emptyWorkbenchPreloadContribution(officeWorkbenchManifest.id);
