import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { HtmlAgentEditingService } from './editing/html-agent-editing-service';
import { htmlAssistantMainFeature } from './generation/main';
import { HtmlWorkbenchProvider } from './main';
import { htmlWorkbenchManifest } from './shared';
import { htmlTargetMainFeature } from './target-main-feature';

export const htmlMainWorkbenchContribution = composeMainWorkbenchContribution(
  htmlWorkbenchManifest,
  (context) => {
    const editing = new HtmlAgentEditingService(
      context.assetService,
      context.generationTasks,
      context.stateDataDatabase,
    );
    return new HtmlWorkbenchProvider(
      context.contentResourceService,
      context.sandboxFrameScripts,
      editing,
      context.workbenchEvents,
    );
  },
  [htmlTargetMainFeature, htmlAssistantMainFeature],
);
