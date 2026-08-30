import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { HtmlConversationContextProvider } from '../conversation/html-conversation-context-provider';
import {
  createHtmlEditFunctionTools,
  type HtmlEditToolRuntime,
} from '../editing/html-edit-function-tools';

let editingRuntime: HtmlEditToolRuntime | undefined;

export function setHtmlEditToolRuntime(
  runtime: HtmlEditToolRuntime | undefined,
): void {
  editingRuntime = runtime;
}

export const htmlAssistantMainFeature = Object.freeze({
  id: 'builtin.html.assistant',
  registerAgentFunctionTools({ functionTools }): void {
    for (const tool of createHtmlEditFunctionTools(() => editingRuntime)) {
      functionTools.register(tool);
    }
  },
  registerGeneration({ conversationContexts }): void {
    conversationContexts.register(
      new HtmlConversationContextProvider(() => editingRuntime),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
