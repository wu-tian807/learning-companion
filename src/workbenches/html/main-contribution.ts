import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { HtmlAgentEditingService } from './editing/html-agent-editing-service';
import { registerHtmlAssistantMain } from './generation/main';
import { HtmlWorkbenchProvider } from './main';
import { htmlWorkbenchManifest } from './shared';

export const htmlMainWorkbenchContribution = composeMainWorkbenchContribution(
  htmlWorkbenchManifest,
  (context) => {
    const editing = new HtmlAgentEditingService(
      context.assetService,
      context.generationTasks,
      context.stateDataDatabase,
    );
    registerHtmlAssistantMain({
      functionTools: context.functionTools,
      conversationContexts: context.conversationContexts,
      editing,
    });
    return new HtmlWorkbenchProvider(
      context.contentResourceService,
      context.sandboxFrameScripts,
      editing,
      context.workbenchEvents,
    );
  },
);
