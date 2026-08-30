import type { WorkbenchConversationContribution } from '../../../renderer/conversation/conversation-contracts';
import { videoWorkbenchManifest } from '../shared';
import {
  describeVideoConversationContext,
  VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
  isVideoConversationContext,
  type VideoConversationContext,
} from './video-conversation-context';

export function createVideoFrameConversationLaunch(
  context: VideoConversationContext,
  conversationId?: string,
): Readonly<{
  context: VideoConversationContext;
  conversationId?: string;
}> {
  const normalizedConversationId = conversationId?.trim();
  return Object.freeze({
    context,
    ...(normalizedConversationId
      ? { conversationId: normalizedConversationId }
      : {}),
  });
}

export function createVideoConversationContribution(input: {
  readonly sourceRevision: string;
  readonly revealContext: (
    context: VideoConversationContext,
  ) => Promise<void> | void;
  readonly onContextReleased?: (
    context: VideoConversationContext | undefined,
  ) => void;
}): WorkbenchConversationContribution {
  const sourceRevision = input.sourceRevision.trim();
  const contribution: WorkbenchConversationContribution = {
    id: `${videoWorkbenchManifest.id}.frame-conversation`,
    workbenchId: videoWorkbenchManifest.id,
    contextProviderId: VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'identity',
    contextRequired: true,
    contextRequiredMessage: '请先在视频画面上单击或拖动选择一个区域',
    isContext(context) {
      return (
        isVideoConversationContext(context) &&
        context.sourceRevision === sourceRevision
      );
    },
    shouldCommitAnswer(taskInput) {
      return (
        isVideoConversationContext(taskInput.context) &&
        taskInput.context.sourceRevision === sourceRevision
      );
    },
    describeContext: describeVideoConversationContext,
    revealContext(context) {
      if (isVideoConversationContext(context)) {
        return input.revealContext(context);
      }
    },
    onContextReleased(context) {
      input.onContextReleased?.(
        isVideoConversationContext(context) ? context : undefined,
      );
    },
  };
  return Object.freeze(contribution);
}
