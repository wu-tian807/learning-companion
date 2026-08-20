import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { htmlAssistantMainFeature } from './generation/main';
import { HtmlWorkbenchProvider } from './main';
import { htmlWorkbenchManifest } from './shared';

export const htmlMainWorkbenchContribution = composeMainWorkbenchContribution(
  htmlWorkbenchManifest,
  (context) =>
    new HtmlWorkbenchProvider(
      context.contentResourceService,
      context.stateDataDatabase,
      context.sandboxFrameScripts,
    ),
  [htmlAssistantMainFeature],
);
