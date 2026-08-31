import type { ReactNode } from 'react';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { userMessageFromError } from '../../../shared/ipc-error';
import { AttachmentHost } from './AttachmentHost';

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
  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-clip">
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
      <AttachmentHost
        projectId={projectId}
        assetId={assetId}
        attachments={attachments}
        sidebarOpen={false}
        onSidebarOpenChange={() => undefined}
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
