import type {
  ConversationHistoryStore,
  WorkbenchConversationContribution,
} from '../../../renderer/conversation/conversation-contracts';
import {
  createConversationHistoryKey,
  createLocalConversationHistoryStore,
} from '../../../renderer/conversation/conversation-history-store';
import { videoWorkbenchManifest } from '../shared';
import {
  VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
  isVideoConversationContext,
  type VideoConversationContext,
} from './video-conversation-context';

export function createVideoConversationHistoryStore(
  projectId: string,
  assetId: string,
  contributionId: string,
  sourceRevision: string,
): ConversationHistoryStore {
  return createLocalConversationHistoryStore({
    key: createConversationHistoryKey({
      contributionId: `${contributionId}.revision.${sourceRevision}`,
      projectId,
      assetId,
    }),
  });
}

export function createVideoFrameConversationLaunch(
  context: VideoConversationContext,
): Readonly<{ context: VideoConversationContext }> {
  return Object.freeze({ context });
}

export function createVideoConversationContribution(input: {
  readonly sourceRevision: string;
  readonly historyStore: ConversationHistoryStore;
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
    initialContextRequired: true,
    initialContextRequiredMessage: '请先在视频画面上按住右键并框选一个区域',
    title: '视频画面问答',
    emptyLabel: '在视频画面上按住右键拖动框选，然后针对当前画面提问。',
    inputPlaceholder: '针对当前画面提问…（Enter 发送 / Shift+Enter 换行）',
    historyStore: input.historyStore,
    isContext(context) {
      return (
        isVideoConversationContext(context) &&
        context.sourceRevision === sourceRevision
      );
    },
    describeContext(context) {
      if (!isVideoConversationContext(context)) {
        return { label: '视频画面' };
      }
      const { timeSeconds, x, y, width, height } = context.target.anchorPayload;
      return {
        label: `视频 ${timeSeconds.toFixed(1)} 秒`,
        detail: `左侧 ${Math.round(x * 100)}% · 顶部 ${Math.round(y * 100)}% · ${Math.round(width * 100)}% × ${Math.round(height * 100)}%`,
      };
    },
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
