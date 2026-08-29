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
  AI_ANNOTATION_ATTACHMENT_TYPE,
  AI_ANNOTATION_ATTACHMENT_VERSION,
} from '../../ai-annotation-attachment';
import {
  DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
  isDocumentConversationContext,
  type DocumentConversationContext,
} from '../../document-conversation-context';

export {
  createDocumentConversationContext,
  isDocumentConversationContext,
  type DocumentConversationContext,
} from '../../document-conversation-context';

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
  /**
   * 提供该回调后，“回归原文”会直接把回复插入到原文选中位置之后，
   * 而不是创建 Attachment 标注卡片。
   */
  readonly returnAnswerToSource?: (input: {
    readonly answer: string;
    readonly question?: string;
    readonly context?: DocumentConversationContext;
  }) => Promise<void> | void;
  readonly onContextReleased?: (
    context: DocumentConversationContext | undefined,
  ) => void;
}): WorkbenchConversationContribution {
  const attachAnswer: WorkbenchConversationContribution['attachAnswer'] =
    input.allowAnswerAttachments || input.returnAnswerToSource
      ? async ({ answer, question, text }) => {
          const context = isDocumentConversationContext(question?.context)
            ? question.context
            : undefined;
          if (input.returnAnswerToSource) {
            await input.returnAnswerToSource({
              answer: answer.text,
              ...(question?.text ? { question: question.text } : {}),
              ...(context ? { context } : {}),
            });
            return;
          }
          const target = context
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
    contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
    includeSourceAssetReference: true,
    title: input.title ?? '资料问答',
    emptyLabel:
      input.emptyLabel ??
      '选择资料中的内容后开始提问，也可以直接针对整份资料提问。',
    inputPlaceholder: '输入问题…（Enter 发送 / Shift+Enter 换行）',
    historyStore: input.historyStore,
    isContext: isDocumentConversationContext,
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
