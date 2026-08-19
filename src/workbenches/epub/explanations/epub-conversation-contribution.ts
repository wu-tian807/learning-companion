import type {
  ConversationHistoryStore,
  WorkbenchConversationContribution,
} from '../../../renderer/conversation/conversation-contracts';
import {
  createConversationHistoryKey,
  createLocalConversationHistoryStore,
} from '../../../renderer/conversation/conversation-history-store';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { epubWorkbenchManifest } from '../shared';
import {
  EPUB_DEFAULT_EXPLANATION_QUESTION,
  EPUB_EXPLANATION_INSTRUCTION_FORMAT,
  EPUB_EXPLANATION_INSTRUCTION_VERSION,
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
  isEpubCfiRangeTarget,
  isEpubExplanationTaskResult,
  type EpubCfiRangeTarget,
} from './shared';

export type EpubConversationContext = JsonValue & {
  readonly target: EpubCfiRangeTarget;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEpubConversationContext(
  value: unknown,
): value is EpubConversationContext {
  return isRecord(value) && isEpubCfiRangeTarget(value.target);
}

export function createEpubConversationContext(
  target: EpubCfiRangeTarget,
): EpubConversationContext {
  return Object.freeze({ target }) as EpubConversationContext;
}

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
  readonly assetId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly revealContext: (
    context: EpubConversationContext,
  ) => Promise<void> | void;
}): WorkbenchConversationContribution {
  const contribution: WorkbenchConversationContribution = {
    id: `${epubWorkbenchManifest.id}.reading-conversation`,
    workbenchId: epubWorkbenchManifest.id,
    title: 'EPUB 阅读问答',
    emptyLabel:
      '选中书中的文字并使用“解释这段话”，之后可以在同一对话中继续追问。',
    inputPlaceholder: '继续追问…（Enter 发送 / Shift+Enter 换行）',
    historyStore: input.historyStore,
    createTaskRequest(taskInput) {
      const context = isEpubConversationContext(taskInput.context)
        ? taskInput.context
        : undefined;
      if (taskInput.generateTitle && !context) {
        throw new Error('请先在 EPUB 中选中一段文字再开始问答');
      }
      const saveAsNote =
        context !== undefined &&
        taskInput.question.trim() === EPUB_DEFAULT_EXPLANATION_QUESTION;
      return {
        projectId: taskInput.projectId,
        definitionId: EPUB_EXPLANATION_TASK_DEFINITION_ID,
        definitionVersion: EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
        instruction: {
          format: EPUB_EXPLANATION_INSTRUCTION_FORMAT,
          version: EPUB_EXPLANATION_INSTRUCTION_VERSION,
          assetId: taskInput.assetId,
          conversationId: taskInput.conversationId,
          question: taskInput.question,
          ...(context
            ? { target: context.target as unknown as JsonValue }
            : {}),
          saveAsNote,
          ...(taskInput.generateTitle ? { generateTitle: true } : {}),
        },
        assetReferences: {},
      };
    },
    readTaskResult(task) {
      if (!isEpubExplanationTaskResult(task.result)) return undefined;
      return {
        answer: task.result.answer,
        ...(task.result.title ? { title: task.result.title } : {}),
        modelInfo: `${task.result.providerId}/${task.result.modelId}`,
      };
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
