import { useMemo, useState, type ReactNode } from 'react';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { userMessageFromError } from '../../../shared/ipc-error';
import { useWorkbenchContributions } from '../../../renderer/workbench/runtime/use-workbench-contributions';
import { AttachmentHost } from './AttachmentHost';
import { createDocumentAnnotationActions } from './document-annotation-actions';
import { DocumentQuestionAnchorsVisibleContext } from './document-question-anchor-visibility';

export interface DocumentAiWorkbenchShellProps {
  readonly projectId: string;
  readonly assetId: string;
  readonly attachments: readonly AssetAttachment[];
  readonly refreshAttachments: () => Promise<void>;
  readonly onError: (message: string) => void;
  readonly children: ReactNode;
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
  const [showQuestionAnchors, setShowQuestionAnchors] = useState(true);
  const [showAttachments, setShowAttachments] = useState(true);
  const actionBundle = useMemo(() => createDocumentAnnotationActions({
    attachmentCount: attachments.length,
    questionAnchorsVisible: showQuestionAnchors,
    attachmentsVisible: showAttachments,
    indexOpen: annotationSidebarOpen,
    onToggleQuestionAnchors: () => setShowQuestionAnchors((visible) => !visible),
    onToggleAttachments: () => setShowAttachments((visible) => {
      if (visible) setAnnotationSidebarOpen(false);
      return !visible;
    }),
    onToggleIndex: () => {
      setShowAttachments(true);
      setAnnotationSidebarOpen((open) => !open);
    },
  }), [annotationSidebarOpen, attachments.length, showAttachments, showQuestionAnchors]);
  useWorkbenchContributions(`document-annotations:${assetId}`, actionBundle);
  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-clip">
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <DocumentQuestionAnchorsVisibleContext.Provider value={showQuestionAnchors}>
          {children}
        </DocumentQuestionAnchorsVisibleContext.Provider>
      </div>
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
