import type {
  ConversationHistoryStore,
  WorkbenchConversationContribution,
} from '../../../renderer/conversation/conversation-contracts';
import {
  createConversationHistoryKey,
  createLocalConversationHistoryStore,
} from '../../../renderer/conversation/conversation-history-store';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { imageWorkbenchManifest } from '../shared';
import {
  IMAGE_DEFAULT_EXPLANATION_QUESTION,
  IMAGE_EXPLANATION_INSTRUCTION_FORMAT,
  IMAGE_EXPLANATION_INSTRUCTION_VERSION,
  IMAGE_EXPLANATION_TASK_DEFINITION_ID,
  IMAGE_EXPLANATION_TASK_DEFINITION_VERSION,
  isImageExplanationTaskResult,
  isImageRegionTarget,
  type ImageRegionTarget,
} from './shared';

export type ImageConversationContext = JsonValue & {
  readonly target: ImageRegionTarget;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isImageConversationContext(
  value: unknown,
): value is ImageConversationContext {
  return isRecord(value) && isImageRegionTarget(value.target);
}

export function createImageConversationContext(
  target: ImageRegionTarget,
): ImageConversationContext {
  return Object.freeze({ target }) as ImageConversationContext;
}

export function createImageConversationHistoryStore(
  projectId: string,
  assetId: string,
  contributionId: string,
): ConversationHistoryStore {
  return createLocalConversationHistoryStore({
    key: createConversationHistoryKey({ contributionId, projectId, assetId }),
  });
}

export function createImageConversationContribution(input: {
  readonly historyStore: ConversationHistoryStore;
  readonly revealContext: (
    context: ImageConversationContext,
  ) => Promise<void> | void;
}): WorkbenchConversationContribution {
  const contribution: WorkbenchConversationContribution = {
    id: `${imageWorkbenchManifest.id}.reading-conversation`,
    workbenchId: imageWorkbenchManifest.id,
    title: '图片解读问答',
    emptyLabel: '框选图片中的兴趣区域并生成解释，之后可以在同一对话中继续追问。',
    inputPlaceholder: '继续追问…（Enter 发送 / Shift+Enter 换行）',
    historyStore: input.historyStore,
    createTaskRequest(taskInput) {
      const context = isImageConversationContext(taskInput.context)
        ? taskInput.context
        : undefined;
      if (taskInput.generateTitle && !context) {
        throw new Error('请先在图片中框选一个兴趣区域再开始问答');
      }
      const saveAsNote =
        context !== undefined &&
        taskInput.question.trim() === IMAGE_DEFAULT_EXPLANATION_QUESTION;
      return {
        projectId: taskInput.projectId,
        definitionId: IMAGE_EXPLANATION_TASK_DEFINITION_ID,
        definitionVersion: IMAGE_EXPLANATION_TASK_DEFINITION_VERSION,
        instruction: {
          format: IMAGE_EXPLANATION_INSTRUCTION_FORMAT,
          version: IMAGE_EXPLANATION_INSTRUCTION_VERSION,
          assetId: taskInput.assetId,
          conversationId: taskInput.conversationId,
          question: taskInput.question,
          ...(context ? { target: context.target as unknown as JsonValue } : {}),
          saveAsNote,
          ...(taskInput.generateTitle ? { generateTitle: true } : {}),
        },
        assetReferences: { image: [{ assetId: taskInput.assetId }] },
      };
    },
    readTaskResult(task) {
      if (!isImageExplanationTaskResult(task.result)) return undefined;
      return {
        answer: task.result.answer,
        ...(task.result.title ? { title: task.result.title } : {}),
        modelInfo: `${task.result.providerId}/${task.result.modelId}`,
      };
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
