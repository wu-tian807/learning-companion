import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import {
  describeDocumentConversationContext,
  DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
} from '../document-ai/document-conversation-context';
import { pdfWorkbenchManifest } from './shared';

export const pdfRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: pdfWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
    conversationContextPresenter: {
      contributionId: `${pdfWorkbenchManifest.id}.document-question`,
      contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
      describe: (context) =>
        describeDocumentConversationContext(context, 'PDF 内容'),
    },
  });
