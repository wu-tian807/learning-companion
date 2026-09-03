import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { epubTargetMainFeature } from './target-main-feature';
import { epubExplanationMainFeature } from './explanations/main';
import { epubReadingNoteMainFeature } from './notes/main';
import { EpubWorkbenchProvider } from './main';
import { epubWorkbenchManifest } from './shared';

export const epubMainWorkbenchContribution = composeMainWorkbenchContribution(
  epubWorkbenchManifest,
  (context) =>
    new EpubWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
    ),
  [
    epubTargetMainFeature,
    epubExplanationMainFeature,
    epubReadingNoteMainFeature,
  ],
);
