import {
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { userMessageFromError } from '../../../shared/ipc-error';
import { AiChatPanelHost } from './ai-chat/AiChatPanelHost';
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
  readonly children: ReactNode;
}

function subscribeHeaderActionSlot(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function getHeaderActionSlot(): Element | null {
  return document.querySelector('[data-workbench-header-actions]');
}

export function DocumentAiWorkbenchShell({
  projectId,
  assetId,
  attachments,
  refreshAttachments,
  onError,
  children,
}: DocumentAiWorkbenchShellProps) {
  const [annotationSidebarOpen, setAnnotationSidebarOpen] = useState(false);
  const headerActionSlot = useSyncExternalStore(
    subscribeHeaderActionSlot,
    getHeaderActionSlot,
    () => null,
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-clip">
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
      <AiChatPanelHost
        projectId={projectId}
        assetId={assetId}
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
            await refreshAttachments();
          } catch (error) {
            const message = userMessageFromError(
              error,
              '无法保存 AI 标注到文档。',
            );
            if (message) onError(message);
            throw error;
          }
        }}
      />
      {headerActionSlot && createPortal(
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAnnotationSidebarOpen((open) => !open)}
            className="rounded-lg border border-indigo-300/25 bg-indigo-400/[0.08] px-2.5 py-1 text-[10px] font-medium text-indigo-200 hover:bg-indigo-400/[0.16]"
            title="查看当前文档的标注"
          >
            ✦ 标注 {attachments.length}
          </button>
          <button
            type="button"
            onClick={() => getGlobalAiChatStore().setPanelOpen(true)}
            className="rounded-lg border border-indigo-300/25 bg-indigo-400/[0.08] px-2.5 py-1 text-[10px] font-medium text-indigo-200 hover:bg-indigo-400/[0.16]"
            title="打开当前文档的 AI 问答"
          >
            ✦ AI 问答
          </button>
        </div>,
        headerActionSlot,
      )}
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
    </div>
  );
}
