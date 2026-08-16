import type { ReactNode } from 'react';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { userMessageFromError } from '../../../shared/ipc-error';
import {
  AiChatPanelHost,
  type AiChatPanelHostProps,
} from './ai-chat/AiChatPanelHost';
import { getGlobalAiChatStore } from './ai-chat/chat-store';
import { AttachmentHost } from './AttachmentHost';
import {
  AI_ANNOTATION_ATTACHMENT_TYPE,
  AI_ANNOTATION_ATTACHMENT_VERSION,
} from '../ai-annotation-attachment';

export interface DocumentAiWorkbenchShellProps {
  readonly projectId: string;
  readonly assetId: string;
  readonly attachments: readonly AssetAttachment[];
  readonly refreshAttachments: () => Promise<void>;
  readonly onError: (message: string) => void;
  readonly allowAnswerAttachments: boolean;
  readonly children: ReactNode;
}

export function DocumentAiWorkbenchShell({
  projectId,
  assetId,
  attachments,
  refreshAttachments,
  onError,
  allowAnswerAttachments,
  children,
}: DocumentAiWorkbenchShellProps) {
  const onAttachAnswer: AiChatPanelHostProps['onAttachAnswer'] =
    allowAnswerAttachments
      ? async (messageId, text, anchor) => {
          const session = getGlobalAiChatStore().getSession(assetId);
          const answerMessage = session?.messages.find(
            (message) => message.id === messageId,
          );
          const userMessage = session?.messages.find(
            (message) => message.id === answerMessage?.replyToMessageId,
          );
          try {
            await window.learningCompanion.createAttachment({
              projectId,
              assetId,
              typeId: AI_ANNOTATION_ATTACHMENT_TYPE,
              typeVersion: AI_ANNOTATION_ATTACHMENT_VERSION,
              target: anchor?.target ?? { scope: 'asset' },
              metadata: {
                contentFormat: 'ai-annotation-v1',
                questionPreview: Array.from(userMessage?.content ?? '')
                  .slice(0, 200)
                  .join(''),
                ...(answerMessage?.modelInfo
                  ? { modelInfo: answerMessage.modelInfo }
                  : {}),
                timestamp: Date.now(),
              },
              body: {
                question: userMessage?.content ?? '',
                answer: answerMessage?.content ?? text,
                selectedAnswer: text,
              },
            });
            await refreshAttachments();
          } catch (error) {
            const message = userMessageFromError(
              error,
              '无法保存 AI 标注到文档。',
            );
            if (message) onError(message);
            throw error;
          }
        }
      : undefined;

  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-clip">
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
      <AiChatPanelHost
        projectId={projectId}
        assetId={assetId}
        onAttachAnswer={onAttachAnswer}
      />
      <AttachmentHost
        projectId={projectId}
        assetId={assetId}
        attachments={attachments}
        onDeleteAttachment={async (attachmentId) => {
          try {
            await window.learningCompanion.deleteAttachment({
              projectId,
              attachmentId,
            });
            await refreshAttachments();
          } catch (error) {
            const message = userMessageFromError(
              error,
              '无法删除附着内容，请重试。',
            );
            if (message) onError(message);
            throw error;
          }
        }}
      />
    </div>
  );
}
