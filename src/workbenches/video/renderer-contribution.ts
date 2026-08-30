import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import {
  describeVideoConversationContext,
  VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
} from './conversation/video-conversation-context';
import { videoWorkbenchManifest } from './shared';

export const videoRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: videoWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
    conversationContextPresenter: {
      contributionId: `${videoWorkbenchManifest.id}.frame-conversation`,
      contextProviderId: VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
      describe: describeVideoConversationContext,
    },
  });
