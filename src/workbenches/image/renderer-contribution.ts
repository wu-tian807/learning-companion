import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import {
  describeImageConversationContext,
  IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
} from './explanations/image-conversation-context';
import { imageWorkbenchManifest } from './shared';

export const imageRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: imageWorkbenchManifest,
    load: async () => (await import('./renderer')).imageRendererWorkbenchModule,
    conversationContextPresenter: {
      contributionId: `${imageWorkbenchManifest.id}.reading-conversation`,
      contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
      describe: describeImageConversationContext,
    },
  });
