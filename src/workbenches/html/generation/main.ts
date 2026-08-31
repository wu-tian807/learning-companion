import { AppError } from '../../../main/errors/app-error';
import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import type { WorkbenchRegistry } from '../../../main/workbench/workbench-registry';
import { HtmlConversationContextProvider } from '../conversation/html-conversation-context-provider';
import { createHtmlEditFunctionTools } from '../editing/html-edit-function-tools';
import type { HtmlAgentEditingService } from '../editing/html-agent-editing-service';
import { HtmlWorkbenchProvider } from '../main';
import { htmlWorkbenchManifest } from '../shared';

function requireHtmlEditingService(
  workbenches: WorkbenchRegistry,
): HtmlAgentEditingService {
  const provider = workbenches.get(htmlWorkbenchManifest.id);
  const editing =
    provider instanceof HtmlWorkbenchProvider
      ? provider.getAgentEditingService()
      : undefined;
  if (!editing) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }
  return editing;
}

export const htmlAssistantMainFeature = Object.freeze({
  id: 'builtin.html.agent-editing',
  registerAgentFunctionTools({ functionTools, workbenches }): void {
    const editing = requireHtmlEditingService(workbenches);
    for (const tool of createHtmlEditFunctionTools(editing)) {
      functionTools.register(tool);
    }
  },
  registerGeneration({ conversationContexts, workbenches }): void {
    const editing = requireHtmlEditingService(workbenches);
    conversationContexts.register(
      new HtmlConversationContextProvider(() => editing),
    );
  },
  start({ workbenches }) {
    const editing = requireHtmlEditingService(workbenches);
    let disposed = false;
    return Object.freeze({
      shutdown(): Promise<void> {
        return editing.shutdown();
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        editing.dispose();
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
