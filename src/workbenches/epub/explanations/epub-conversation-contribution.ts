import type { WorkbenchConversationContribution } from '../../../renderer/conversation/conversation-contracts';
import {
  EPUB_DEFAULT_EXPLANATION_QUESTION,
} from './shared';
import {
  EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
  parseEpubConversationContext,
} from './epub-conversation-context';

export {
  createEpubConversationContext,
  isEpubConversationContext,
  parseEpubConversationContext,
  type EpubConversationContext,
} from './epub-conversation-context';

export function createEpubConversationContribution(): WorkbenchConversationContribution {
  const contribution: WorkbenchConversationContribution = {
    contextProviderId: EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'identity',
    contextRequired: true,
    contextRequiredMessage:
      '请先在 EPUB 中选中一段文字再开始问答',
    isContext: (context) =>
      parseEpubConversationContext(context) !== undefined,
    shouldCommitAnswer(taskInput) {
      return (
        parseEpubConversationContext(taskInput.context) !== undefined &&
        taskInput.question.trim() === EPUB_DEFAULT_EXPLANATION_QUESTION
      );
    },
  };
  return Object.freeze(contribution);
}
