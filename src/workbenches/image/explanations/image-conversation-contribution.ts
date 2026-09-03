import type { WorkbenchConversationContribution } from '../../../renderer/conversation/conversation-contracts';
import {
  IMAGE_DEFAULT_EXPLANATION_QUESTION,
} from './shared';
import {
  IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
  parseImageConversationContext,
} from './image-conversation-context';

export {
  createImageConversationContext,
  isImageConversationContext,
  parseImageConversationContext,
  type ImageConversationContext,
} from './image-conversation-context';

const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9._-]{1,256}$/u;

export function createImageConversationContribution(input: {
  readonly sourceRevision: string;
}): WorkbenchConversationContribution {
  const sourceRevision = input.sourceRevision.trim();
  if (!SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    throw new Error('图片内容版本无效');
  }
  const contribution: WorkbenchConversationContribution = {
    contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'reference',
    contextRequired: true,
    contextRequiredMessage:
      '请先在图片中框选一个兴趣区域再开始问答',
    isContext(context) {
      const parsed = parseImageConversationContext(context);
      return (
        parsed !== undefined &&
        parsed.sourceRevision === sourceRevision
      );
    },
    shouldCommitAnswer(taskInput) {
      const context = parseImageConversationContext(taskInput.context);
      return (
        context !== undefined &&
        context.sourceRevision === sourceRevision &&
        taskInput.question.trim() === IMAGE_DEFAULT_EXPLANATION_QUESTION
      );
    },
  };
  return Object.freeze(contribution);
}
