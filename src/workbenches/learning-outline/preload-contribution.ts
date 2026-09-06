import { emptyWorkbenchPreloadContribution } from '../../preload/workbench-preload-contribution';
import { learningOutlineWorkbenchManifest } from './shared';

export const learningOutlinePreloadWorkbenchContribution =
  emptyWorkbenchPreloadContribution(learningOutlineWorkbenchManifest.id);
