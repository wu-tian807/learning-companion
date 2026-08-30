import type { WorkbenchConversationContribution } from '../../../renderer/conversation/conversation-contracts';
import { epubWorkbenchManifest } from '../shared';
import {
  EPUB_DEFAULT_EXPLANATION_QUESTION,
} from './shared';
import {
  describeEpubConversationContext,
  EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
  isEpubConversationContext,
  type EpubConversationContext,
} from './epub-conversation-context';

export {
  createEpubConversationContext,
  isEpubConversationContext,
  type EpubConversationContext,
} from './epub-conversation-context';

export function createEpubConversationContribution(input: {
  readonly revealContext: (
    context: EpubConversationContext,
  ) => Promise<void> | void;
}): WorkbenchConversationContribution {
  const contribution: WorkbenchConversationContribution = {
    id: `${epubWorkbenchManifest.id}.reading-conversation`,
    workbenchId: epubWorkbenchManifest.id,
    contextProviderId: EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'identity',
    contextRequired: true,
    contextRequiredMessage:
      '请先在 EPUB 中选中一段文字再开始问答',
    isContext: isEpubConversationContext,
    shouldCommitAnswer(taskInput) {
      return (
        isEpubConversationContext(taskInput.context) &&
        taskInput.question.trim() === EPUB_DEFAULT_EXPLANATION_QUESTION
      );
    },
    describeContext: describeEpubConversationContext,
    revealContext(context) {
      if (isEpubConversationContext(context)) {
        return input.revealContext(context);
      }
    },
  };
  return Object.freeze(contribution);
}
