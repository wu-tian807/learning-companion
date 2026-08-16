import { useEffect } from 'react';

import { getGlobalAiChatStore } from '../../workbenches/document-ai/renderer/ai-chat/chat-store';
import { AiChatPanelHost } from '../../workbenches/document-ai/renderer/ai-chat/AiChatPanelHost';
import {
  AI_ANNOTATION_ATTACHMENT_TYPE,
  AI_ANNOTATION_ATTACHMENT_VERSION,
} from '../../workbenches/document-ai/ai-annotation-attachment';
import { userMessageFromError } from '../../shared/ipc-error';

export interface ProjectAiQuestionHostProps {
  readonly projectId: string;
  readonly assetId: string | undefined;
  readonly onError: (message: string) => void;
}

/**
 * Project-wide AI question host.
 *
 * This intentionally lives above the workbench tree: every workbench can
 * open the same question panel, while a workbench that has a selection only
 * contributes its anchor through the shared chat store. The current selected
 * Asset is the question context and keeps each Asset's saved history isolated.
 */
export function ProjectAiQuestionHost({
  projectId,
  assetId,
  onError,
}: ProjectAiQuestionHostProps) {
  const store = getGlobalAiChatStore();

  useEffect(() => {
    if (assetId) store.ensureSession(projectId, assetId);
  }, [assetId, projectId, store]);

  if (!assetId) return null;

  return (
    <AiChatPanelHost
      projectId={projectId}
      assetId={assetId}
      store={store}
      onAttachAnswer={async (messageId, text, anchor) => {
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
          window.dispatchEvent(
            new CustomEvent('learning-companion:attachments-changed', {
              detail: { projectId, assetId },
            }),
          );
        } catch (error) {
          const message = userMessageFromError(
            error,
            '无法保存 AI 标注到资料，请重试。',
          );
          if (message) onError(message);
          throw error;
        }
      }}
    />
  );
}
