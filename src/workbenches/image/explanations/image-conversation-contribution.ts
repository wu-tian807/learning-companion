import type { WorkbenchConversationContribution } from '../../../renderer/conversation/conversation-contracts';
import { imageWorkbenchManifest } from '../shared';
import {
  IMAGE_DEFAULT_EXPLANATION_QUESTION,
} from './shared';
import {
  describeImageConversationContext,
  IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
  isImageConversationContext,
  type ImageConversationContext,
} from './image-conversation-context';

export {
  createImageConversationContext,
  isImageConversationContext,
  type ImageConversationContext,
} from './image-conversation-context';

const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9._-]{1,256}$/u;

export function createImageConversationContribution(input: {
  readonly sourceRevision: string;
  readonly revealContext: (
    context: ImageConversationContext,
  ) => Promise<void> | void;
}): WorkbenchConversationContribution {
  const sourceRevision = input.sourceRevision.trim();
  if (!SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    throw new Error('图片内容版本无效');
  }
  const contribution: WorkbenchConversationContribution = {
    id: `${imageWorkbenchManifest.id}.reading-conversation`,
    workbenchId: imageWorkbenchManifest.id,
    contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'reference',
    contextRequired: true,
    contextRequiredMessage:
      '请先在图片中框选一个兴趣区域再开始问答',
    isContext(context) {
      return (
        isImageConversationContext(context) &&
        context.sourceRevision === sourceRevision
      );
    },
    shouldCommitAnswer(taskInput) {
      return (
        isImageConversationContext(taskInput.context) &&
        taskInput.context.sourceRevision === sourceRevision &&
        taskInput.question.trim() === IMAGE_DEFAULT_EXPLANATION_QUESTION
      );
    },
    describeContext: describeImageConversationContext,
    revealContext(context) {
      if (isImageConversationContext(context)) return input.revealContext(context);
    },
  };
  return Object.freeze(contribution);
}
