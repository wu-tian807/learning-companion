import { emptyWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { markdownWorkbenchManifest } from './shared';

export const markdownPreloadWorkbenchContribution =
  emptyWorkbenchPreloadContribution(markdownWorkbenchManifest.id);
