import { emptyWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { pdfWorkbenchManifest } from './shared';

export const pdfPreloadWorkbenchContribution =
  emptyWorkbenchPreloadContribution(pdfWorkbenchManifest.id);
