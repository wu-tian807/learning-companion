import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { imageExplanationMainFeature } from './explanations/main';
import { ImageWorkbenchProvider } from './main';
import { imageWorkbenchManifest } from './shared';
import { imageTargetMainFeature } from './target-main-feature';

export const imageMainWorkbenchContribution = composeMainWorkbenchContribution(
  imageWorkbenchManifest,
  (context) =>
    new ImageWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
    ),
  [imageTargetMainFeature, imageExplanationMainFeature],
);
