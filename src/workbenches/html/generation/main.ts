import type { AgentFunctionToolRegistryApi } from '../../../main/agents/function-tools/agent-function-tool-registry';
import type { WorkbenchConversationContextProviderRegistry } from '../../../main/conversation/workbench-conversation-context-provider-registry';
import { HtmlConversationContextProvider } from '../conversation/html-conversation-context-provider';
import {
  createHtmlEditFunctionTools,
  type HtmlEditToolRuntime,
} from '../editing/html-edit-function-tools';

export function registerHtmlAssistantMain(input: {
  readonly functionTools: AgentFunctionToolRegistryApi;
  readonly conversationContexts: WorkbenchConversationContextProviderRegistry;
  readonly editing: HtmlEditToolRuntime;
}): void {
  for (const tool of createHtmlEditFunctionTools(input.editing)) {
    input.functionTools.register(tool);
  }
  input.conversationContexts.register(
    new HtmlConversationContextProvider(() => input.editing),
  );
}
