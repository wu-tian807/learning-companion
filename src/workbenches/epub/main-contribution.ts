import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { epubExplanationMainFeature } from './explanations/main';
import { EpubWorkbenchProvider } from './main';
import { epubWorkbenchManifest } from './shared';

export const epubMainWorkbenchContribution = composeMainWorkbenchContribution(
  epubWorkbenchManifest,
  (context) =>
    new EpubWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
    ),
  [epubExplanationMainFeature],
);
