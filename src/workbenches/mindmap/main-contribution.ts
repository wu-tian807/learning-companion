import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { mindMapGenerationMainFeature } from './generation/main';
import { MindMapWorkbenchProvider } from './main';
import { mindMapWorkbenchManifest } from './shared';

export const mindMapMainWorkbenchContribution =
  composeMainWorkbenchContribution(
    mindMapWorkbenchManifest,
    (context) =>
      new MindMapWorkbenchProvider(
        context.stateDatabase,
        context.associationService,
      ),
    [mindMapGenerationMainFeature],
  );
