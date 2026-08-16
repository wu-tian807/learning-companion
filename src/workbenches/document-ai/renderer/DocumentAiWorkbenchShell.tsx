import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { userMessageFromError } from '../../../shared/ipc-error';
import {
  AI_ANNOTATION_ATTACHMENT_TYPE,
  AI_ANNOTATION_ATTACHMENT_VERSION,
} from '../ai-annotation-attachment';
import { AttachmentHost } from './AttachmentHost';
import {
  AiChatPanelHost,
  type AiChatPanelHostProps,
} from './ai-chat/AiChatPanelHost';
import { getGlobalAiChatStore } from './ai-chat/chat-store';
import { DocumentMarkerVisibilityMenu } from './DocumentMarkerVisibilityMenu';
import { QuestionAnchorHost } from './QuestionAnchorHost';

export interface DocumentAiWorkbenchShellProps {
  readonly projectId: string;
  readonly assetId: string;
  readonly attachments: readonly AssetAttachment[];
  readonly refreshAttachments: () => Promise<void>;
  readonly onError: (message: string) => void;
  readonly allowAnswerAttachments: boolean;
  readonly children: ReactNode;
}

function subscribeProjectActionSlot(onChange: () => void): () => void {
  let currentSlot = getProjectActionSlot();
  const observer = new MutationObserver(() => {
    const nextSlot = getProjectActionSlot();
    if (nextSlot === currentSlot) return;
    currentSlot = nextSlot;
    onChange();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function getProjectActionSlot(): Element | null {
  return document.querySelector('[data-project-ai-context-actions]');
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
  const [annotationSidebarOpen, setAnnotationSidebarOpen] = useState(false);
  const [visibilityMenuOpen, setVisibilityMenuOpen] = useState(false);
  const [showQuestionAnchors, setShowQuestionAnchors] = useState(true);
  const [showAttachments, setShowAttachments] = useState(true);
  const projectActionSlot = useSyncExternalStore(
    subscribeProjectActionSlot,
    getProjectActionSlot,
    () => null,
  );
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
      {projectActionSlot && createPortal(
        <div className="flex items-center gap-2">
          <DocumentMarkerVisibilityMenu
            open={visibilityMenuOpen}
            showQuestionAnchors={showQuestionAnchors}
            showAttachments={showAttachments}
            onOpenChange={setVisibilityMenuOpen}
            onShowQuestionAnchorsChange={setShowQuestionAnchors}
            onShowAttachmentsChange={(show) => {
              setShowAttachments(show);
              if (!show) setAnnotationSidebarOpen(false);
            }}
          />
          <button
            type="button"
            onClick={() => {
              setShowAttachments(true);
              setAnnotationSidebarOpen((open) => !open);
            }}
            className="ui-icon-button grid size-[32px] place-items-center rounded-[10px] border border-white/10 text-slate-400 outline-none hover:border-indigo-300/55 hover:text-indigo-200"
            aria-label={`打开标注（${attachments.length}）`}
            title={`打开标注（${attachments.length}）`}
          >
            <span aria-hidden="true">✦</span>
          </button>
        </div>,
        projectActionSlot,
      )}
      {showQuestionAnchors && (
        <QuestionAnchorHost projectId={projectId} assetId={assetId} />
      )}
      <AiChatPanelHost
        projectId={projectId}
        assetId={assetId}
        onAttachAnswer={onAttachAnswer}
      />
      {showAttachments && (
        <AttachmentHost
          projectId={projectId}
          assetId={assetId}
          attachments={attachments}
          sidebarOpen={annotationSidebarOpen}
          onSidebarOpenChange={setAnnotationSidebarOpen}
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
      )}
    </div>
  );
}
