import {
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { userMessageFromError } from '../../../shared/ipc-error';
import { AttachmentHost } from './AttachmentHost';
import { DocumentQuestionAnchorsVisibleContext } from './document-question-anchor-visibility';
import { DocumentMarkerVisibilityMenu } from './DocumentMarkerVisibilityMenu';

export interface DocumentAiWorkbenchShellProps {
  readonly projectId: string;
  readonly assetId: string;
  readonly attachments: readonly AssetAttachment[];
  readonly refreshAttachments: () => Promise<void>;
  readonly onError: (message: string) => void;
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
  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-clip">
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <DocumentQuestionAnchorsVisibleContext.Provider value={showQuestionAnchors}>
          {children}
        </DocumentQuestionAnchorsVisibleContext.Provider>
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
