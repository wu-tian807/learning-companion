import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import {
  describeEpubConversationContext,
  EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
} from './explanations/epub-conversation-context';
import { epubWorkbenchManifest } from './shared';

export const epubRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: epubWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
    conversationContextPresenter: {
      contributionId: `${epubWorkbenchManifest.id}.reading-conversation`,
      contextProviderId: EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
      describe: describeEpubConversationContext,
    },
  });
