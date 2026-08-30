import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { HtmlConversationContextProvider } from '../conversation/html-conversation-context-provider';
import { HtmlAgentEditingService } from '../editing/html-agent-editing-service';
import { createHtmlEditFunctionTools } from '../editing/html-edit-function-tools';
import { HtmlEditGenerationObserver } from '../editing/html-edit-generation-observer';

let editingService: HtmlAgentEditingService | undefined;

export function getHtmlAgentEditingService(): HtmlAgentEditingService | undefined {
  return editingService;
}

export const htmlAssistantMainFeature = Object.freeze({
  id: 'builtin.html.assistant',
  registerAgentFunctionTools({
    functionTools,
    assets,
    recoveryDirectory,
  }): void {
    if (editingService) {
      throw new Error('HTML editing service 已初始化');
    }
    editingService = new HtmlAgentEditingService(recoveryDirectory, assets);
    for (const tool of createHtmlEditFunctionTools(editingService)) {
      functionTools.register(tool);
    }
  },
  registerGeneration({ conversationContexts }): void {
    conversationContexts.register(
      new HtmlConversationContextProvider(editingService),
    );
  },
  start({ generationTasks }) {
    if (!editingService) {
      throw new Error('HTML editing service 尚未初始化');
    }
    editingService.attachGenerationTasks(generationTasks);
    const observer = new HtmlEditGenerationObserver(
      generationTasks,
      editingService,
    );
    let shutdownTask: Promise<void> | undefined;
    return Object.freeze({
      shutdown(): Promise<void> {
        observer.dispose();
        shutdownTask ??= observer.drain();
        return shutdownTask;
      },
      dispose(): void {
        observer.dispose();
        editingService?.dispose();
        editingService = undefined;
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
