import type {
  ConversationHistoryStore,
  WorkbenchConversationContribution,
} from '../../../../renderer/conversation/conversation-contracts';
import {
  createConversationHistoryKey,
  createLocalConversationHistoryStore,
} from '../../../../renderer/conversation/conversation-history-store';
import { revealWorkbenchAnchor } from '../../../../renderer/workbench/host/workbench-anchor-bridge';
import {
  DOCUMENT_QUESTION_INSTRUCTION_FORMAT,
  DOCUMENT_QUESTION_INSTRUCTION_VERSION,
  DOCUMENT_QUESTION_TASK_DEFINITION_ID,
  DOCUMENT_QUESTION_TASK_DEFINITION_VERSION,
} from '../../../../shared/generation-definitions';
import { isAssetTarget, type AssetTarget } from '../../../../shared/workbench/anchor';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import {
  AI_ANNOTATION_ATTACHMENT_TYPE,
  AI_ANNOTATION_ATTACHMENT_VERSION,
} from '../../ai-annotation-attachment';
import { isDocumentQuestionTaskResult } from '../../shared';

export type DocumentConversationContext = JsonValue & {
  readonly target: AssetTarget;
  readonly pageNumber?: number;
  readonly selectedText?: string;
  readonly previewDataUrl?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDocumentConversationContext(
  value: unknown,
): value is DocumentConversationContext {
  if (!isRecord(value) || !isAssetTarget(value.target)) return false;
  return (
    (value.pageNumber === undefined ||
      (Number.isSafeInteger(value.pageNumber) && Number(value.pageNumber) > 0)) &&
    (value.selectedText === undefined || typeof value.selectedText === 'string') &&
    (value.previewDataUrl === undefined ||
      (typeof value.previewDataUrl === 'string' &&
        /^data:image\/(?:png|jpe?g);base64,/u.test(value.previewDataUrl)))
  );
}

export function createDocumentConversationContext(input: {
  readonly target: AssetTarget;
  readonly pageNumber?: number;
  readonly selectedText?: string;
  readonly previewDataUrl?: string;
}): DocumentConversationContext {
  return Object.freeze({
    target: input.target,
    ...(input.pageNumber === undefined ? {} : { pageNumber: input.pageNumber }),
    ...(input.selectedText?.trim() ? { selectedText: input.selectedText.trim() } : {}),
    ...(input.previewDataUrl ? { previewDataUrl: input.previewDataUrl } : {}),
  }) as DocumentConversationContext;
}

export function createDocumentConversationHistoryStore(
  projectId: string,
  assetId: string,
  contributionId: string,
): ConversationHistoryStore {
  return createLocalConversationHistoryStore({
    key: createConversationHistoryKey({ contributionId, projectId, assetId }),
    legacyMessageArrayKeys: [
      `learning-companion:document-ai-history:v1:${encodeURIComponent(projectId)}:${encodeURIComponent(assetId)}`,
    ],
  });
}

export function createDocumentConversationContribution(input: {
  readonly projectId: string;
  readonly assetId: string;
  readonly workbenchId: string;
  readonly contributionId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly title?: string;
  readonly emptyLabel?: string;
  readonly contextLabel?: string;
  readonly allowAnswerAttachments?: boolean;
  readonly onContextReleased?: (
    context: DocumentConversationContext | undefined,
  ) => void;
}): WorkbenchConversationContribution {
  const attachAnswer: WorkbenchConversationContribution['attachAnswer'] =
    input.allowAnswerAttachments
      ? async ({ answer, question, text }) => {
          const context = question?.context;
          const target = isDocumentConversationContext(context)
            ? context.target
            : { scope: 'asset' as const };
          await window.learningCompanion.createAttachment({
            projectId: input.projectId,
            assetId: input.assetId,
            typeId: AI_ANNOTATION_ATTACHMENT_TYPE,
            typeVersion: AI_ANNOTATION_ATTACHMENT_VERSION,
            target,
            metadata: {
              contentFormat: 'ai-annotation-v1',
              questionPreview: Array.from(question?.text ?? '').slice(0, 200).join(''),
              ...(answer.modelInfo ? { modelInfo: answer.modelInfo } : {}),
              timestamp: Date.now(),
            },
            body: {
              question: question?.text ?? '',
              answer: answer.text,
              selectedAnswer: text,
            },
          });
          window.dispatchEvent(
            new CustomEvent('learning-companion:attachments-changed', {
              detail: { projectId: input.projectId, assetId: input.assetId },
            }),
          );
        }
      : undefined;

  const contribution: WorkbenchConversationContribution = {
    id: input.contributionId,
    workbenchId: input.workbenchId,
    title: input.title ?? '资料问答',
    emptyLabel:
      input.emptyLabel ??
      '选择资料中的内容后开始提问，也可以直接针对整份资料提问。',
    inputPlaceholder: '输入问题…（Enter 发送 / Shift+Enter 换行）',
    historyStore: input.historyStore,
    createTaskRequest(taskInput) {
      const context = isDocumentConversationContext(taskInput.context)
        ? taskInput.context
        : undefined;
      return {
        projectId: taskInput.projectId,
        definitionId: DOCUMENT_QUESTION_TASK_DEFINITION_ID,
        definitionVersion: DOCUMENT_QUESTION_TASK_DEFINITION_VERSION,
        instruction: {
          format: DOCUMENT_QUESTION_INSTRUCTION_FORMAT,
          version: DOCUMENT_QUESTION_INSTRUCTION_VERSION,
          question: taskInput.question,
          conversationId: taskInput.conversationId,
          target: (context?.target ?? { scope: 'asset' }) as JsonValue,
          ...(context?.selectedText ? { selectedText: context.selectedText } : {}),
          ...(taskInput.generateTitle ? { generateTitle: true } : {}),
        },
        assetReferences: {
          document: [{ assetId: taskInput.assetId }],
        },
      };
    },
    readTaskResult(task) {
      if (!isDocumentQuestionTaskResult(task.result)) return undefined;
      return {
        answer: task.result.answer,
        ...(task.result.title ? { title: task.result.title } : {}),
        modelInfo: `${task.result.providerId}/${task.result.modelId}`,
      };
    },
    describeContext(context) {
      if (!isDocumentConversationContext(context)) {
        return { label: input.contextLabel ?? '资料内容' };
      }
      return {
        label: context.pageNumber
          ? `第 ${context.pageNumber} 页`
          : input.contextLabel ?? '资料内容',
        ...(context.selectedText
          ? { detail: context.selectedText }
          : { detail: '已框选公式、图表或图片区域' }),
        ...(context.previewDataUrl
          ? { previewDataUrl: context.previewDataUrl }
          : {}),
      };
    },
    revealContext(context) {
      if (isDocumentConversationContext(context)) {
        revealWorkbenchAnchor(input.assetId, context.target);
      }
    },
    onContextReleased(context) {
      input.onContextReleased?.(
        isDocumentConversationContext(context) ? context : undefined,
      );
    },
    ...(attachAnswer ? { attachAnswer } : {}),
  };

  return Object.freeze(contribution);
}
