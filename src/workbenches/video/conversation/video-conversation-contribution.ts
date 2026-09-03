import type { WorkbenchConversationContribution } from '../../../renderer/conversation/conversation-contracts';
import {
  VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
  parseVideoConversationContext,
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
  readonly onContextReleased?: (
    context: VideoConversationContext | undefined,
  ) => void;
}): WorkbenchConversationContribution {
  const sourceRevision = input.sourceRevision.trim();
  const contribution: WorkbenchConversationContribution = {
    contextProviderId: VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'identity',
    contextRequired: true,
    contextRequiredMessage: '请先在视频画面上单击或拖动选择一个区域',
    isContext(context) {
      const parsed = parseVideoConversationContext(context);
      return (
        parsed !== undefined &&
        parsed.sourceRevision === sourceRevision
      );
    },
    shouldCommitAnswer(taskInput) {
      const context = parseVideoConversationContext(taskInput.context);
      return (
        context !== undefined &&
        context.sourceRevision === sourceRevision
      );
    },
    onContextReleased(context) {
      input.onContextReleased?.(
        parseVideoConversationContext(context),
      );
    },
  };
  return Object.freeze(contribution);
}
