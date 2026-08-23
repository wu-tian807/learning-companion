import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { HtmlConversationContextProvider } from '../conversation/html-conversation-context-provider';

export const htmlAssistantMainFeature = Object.freeze({
  id: 'builtin.html.assistant',
  registerGeneration({ conversationContexts }): void {
    conversationContexts.register(new HtmlConversationContextProvider());
  },
} satisfies MainWorkbenchFeatureContribution);
