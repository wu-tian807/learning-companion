import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import {
  describeDocumentConversationContext,
  DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
} from '../document-ai/document-conversation-context';
import { markdownWorkbenchManifest } from './shared';

export const markdownRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: markdownWorkbenchManifest,
    load: async () =>
      (await import('./renderer')).markdownRendererWorkbenchModule,
    conversationContextPresenter: {
      contributionId: `${markdownWorkbenchManifest.id}.document-question`,
      contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
      describe: (context) =>
        describeDocumentConversationContext(context, 'Markdown 选区'),
    },
  });
