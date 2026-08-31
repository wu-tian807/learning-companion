import { AppError } from '../../../main/errors/app-error';
import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import type { MainWorkbenchProvider } from '../../../main/workbench/workbench-session';
import { HtmlConversationContextProvider } from '../conversation/html-conversation-context-provider';
import { createHtmlEditFunctionTools } from '../editing/html-edit-function-tools';
import type { HtmlAgentEditingService } from '../editing/html-agent-editing-service';
import { HtmlWorkbenchProvider } from '../main';

function requireHtmlEditingService(
  provider: MainWorkbenchProvider | undefined,
): HtmlAgentEditingService {
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
  registerAgentFunctionTools({ functionTools, provider }): void {
    const editing = requireHtmlEditingService(provider);
    for (const tool of createHtmlEditFunctionTools(editing)) {
      functionTools.register(tool);
    }
  },
  registerGeneration({ conversationContexts, provider }): void {
    const editing = requireHtmlEditingService(provider);
    conversationContexts.register(
      new HtmlConversationContextProvider(() => editing),
    );
  },
  start({ provider }) {
    const editing = requireHtmlEditingService(provider);
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
