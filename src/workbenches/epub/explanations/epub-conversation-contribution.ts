import type {
  ConversationHistoryStore,
  WorkbenchConversationContribution,
} from '../../../renderer/conversation/conversation-contracts';
import {
  createConversationHistoryKey,
  createLocalConversationHistoryStore,
} from '../../../renderer/conversation/conversation-history-store';
import { epubWorkbenchManifest } from '../shared';
import {
  EPUB_DEFAULT_EXPLANATION_QUESTION,
} from './shared';
import {
  EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
  isEpubConversationContext,
  type EpubConversationContext,
} from './epub-conversation-context';

export {
  createEpubConversationContext,
  isEpubConversationContext,
  type EpubConversationContext,
} from './epub-conversation-context';

export function createEpubConversationHistoryStore(
  projectId: string,
  assetId: string,
  contributionId: string,
): ConversationHistoryStore {
  return createLocalConversationHistoryStore({
    key: createConversationHistoryKey({
      contributionId,
      projectId,
      assetId,
    }),
  });
}

export function createEpubConversationContribution(input: {
  readonly historyStore: ConversationHistoryStore;
  readonly revealContext: (
    context: EpubConversationContext,
  ) => Promise<void> | void;
}): WorkbenchConversationContribution {
  const contribution: WorkbenchConversationContribution = {
    id: `${epubWorkbenchManifest.id}.reading-conversation`,
    workbenchId: epubWorkbenchManifest.id,
    contextProviderId: EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
    initialContextRequired: true,
    initialContextRequiredMessage:
      '请先在 EPUB 中选中一段文字再开始问答',
    title: 'EPUB 阅读问答',
    emptyLabel:
      '选中书中的文字并使用“解释这段话”，之后可以在同一对话中继续追问。',
    inputPlaceholder: '继续追问…（Enter 发送 / Shift+Enter 换行）',
    historyStore: input.historyStore,
    isContext: isEpubConversationContext,
    shouldCommitAnswer(taskInput) {
      return (
        isEpubConversationContext(taskInput.context) &&
        taskInput.question.trim() === EPUB_DEFAULT_EXPLANATION_QUESTION
      );
    },
    describeContext(context) {
      if (!isEpubConversationContext(context)) {
        return { label: 'EPUB 选区' };
      }
      return {
        label: 'EPUB 选区',
        detail: context.target.anchorPayload.quote.exact,
      };
    },
    revealContext(context) {
      if (isEpubConversationContext(context)) {
        return input.revealContext(context);
      }
    },
  };
  return Object.freeze(contribution);
}
