import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import {
  describeDocumentConversationContext,
  DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
} from '../document-ai/document-conversation-context';
import { plainTextWorkbenchManifest } from './shared';

export const plainTextRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: plainTextWorkbenchManifest,
    load: async () =>
      (await import('./renderer')).plainTextRendererWorkbenchModule,
    conversationContextPresenter: {
      contributionId: `${plainTextWorkbenchManifest.id}.document-question`,
      contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
      describe: (context) =>
        describeDocumentConversationContext(context, '文本选区'),
    },
  });
