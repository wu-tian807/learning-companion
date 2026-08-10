import type { AssetAttachment } from '../../../shared/attachments/contracts';

export interface AttachmentHostProps {
  readonly attachments: readonly AssetAttachment[];
}

export function AttachmentHost({
  attachments,
}: AttachmentHostProps) {
  if (attachments.length === 0) {
    return null;
  }

  return null;
}
