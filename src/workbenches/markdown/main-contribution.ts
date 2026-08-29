import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { markdownMainFeature } from './main-feature';
import { MarkdownWorkbenchProvider } from './main';
import { markdownWorkbenchManifest } from './shared';

export const markdownMainWorkbenchContribution =
  composeMainWorkbenchContribution(markdownWorkbenchManifest, (context) =>
    new MarkdownWorkbenchProvider(
      context.stateDatabase,
      context.stateDataDatabase,
    ), [markdownMainFeature]);
