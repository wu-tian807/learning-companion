import type {
  ConversationAnswerActionPresentation,
  WorkbenchConversationContribution,
} from '../../../../renderer/conversation/conversation-contracts';
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

interface DocumentConversationContributionBaseInput {
  readonly projectId: string;
  readonly assetId: string;
  readonly onContextReleased?: (
    context: DocumentConversationContext | undefined,
  ) => void;
}

interface ReturnAnswerToSourceInput {
  readonly text: string;
  readonly question?: string;
  readonly context?: DocumentConversationContext;
}

type DocumentConversationContributionInput =
  DocumentConversationContributionBaseInput & (
    | {
        readonly allowAnswerAttachments?: false;
        readonly returnAnswerToSource?: undefined;
        readonly answerActionPresentation?: undefined;
      }
    | {
        readonly allowAnswerAttachments: true;
        readonly returnAnswerToSource?: undefined;
        readonly answerActionPresentation: ConversationAnswerActionPresentation;
      }
    | {
        readonly allowAnswerAttachments?: false;
        /** Workbench-owned source mutation; takes the actual selected/full answer text. */
        readonly returnAnswerToSource: (
          input: ReturnAnswerToSourceInput,
        ) => Promise<void> | void;
        readonly answerActionPresentation: ConversationAnswerActionPresentation;
      }
  );

export function createDocumentConversationContribution(
  input: DocumentConversationContributionInput,
): WorkbenchConversationContribution {
  const answerAction: WorkbenchConversationContribution['answerAction'] =
    input.allowAnswerAttachments || input.returnAnswerToSource
      ? {
          ...input.answerActionPresentation,
          async execute({ answer, question, text }) {
            const context = isDocumentConversationContext(question?.context)
              ? question.context
              : undefined;
            if (input.returnAnswerToSource) {
              await input.returnAnswerToSource({
                text,
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
          },
        }
      : undefined;

  const contribution: WorkbenchConversationContribution = {
    contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'reference',
    isContext: isDocumentConversationContext,
    onContextReleased(context) {
      input.onContextReleased?.(
        isDocumentConversationContext(context) ? context : undefined,
      );
    },
    ...(answerAction ? { answerAction } : {}),
  };

  return Object.freeze(contribution);
}
