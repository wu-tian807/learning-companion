import type { WorkbenchConversationContribution } from '../../../renderer/conversation/conversation-contracts';
import { imageWorkbenchManifest } from '../shared';
import {
  IMAGE_DEFAULT_EXPLANATION_QUESTION,
} from './shared';
import {
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
    initialContextRequired: true,
    initialContextRequiredMessage:
      '请先在图片中框选一个兴趣区域再开始问答',
    title: '图片解读问答',
    emptyLabel: '框选图片中的兴趣区域并生成解释，之后可以在同一对话中继续追问。',
    inputPlaceholder: '继续追问…（Enter 发送 / Shift+Enter 换行）',
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
    describeContext(context) {
      if (!isImageConversationContext(context)) return { label: '图片兴趣区域' };
      const region = context.target.anchorPayload;
      return {
        label: '图片兴趣区域',
        detail: `左侧 ${Math.round(region.x * 100)}% · 顶部 ${Math.round(region.y * 100)}% · ${Math.round(region.width * 100)}% × ${Math.round(region.height * 100)}%`,
      };
    },
    revealContext(context) {
      if (isImageConversationContext(context)) return input.revealContext(context);
    },
  };
  return Object.freeze(contribution);
}
