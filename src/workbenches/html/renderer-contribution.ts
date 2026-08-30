import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { describeHtmlConversationContext } from './conversation/anchor-summary';
import { HTML_CONVERSATION_CONTEXT_PROVIDER_ID } from './conversation/html-conversation-context';
import { htmlWorkbenchManifest } from './shared';

export const htmlRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: htmlWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
    conversationContextPresenter: {
      contributionId: 'html.assistant',
      contextProviderId: HTML_CONVERSATION_CONTEXT_PROVIDER_ID,
      describe: describeHtmlConversationContext,
    },
  });
