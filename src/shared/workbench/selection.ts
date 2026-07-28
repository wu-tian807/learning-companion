import {
  isAssetAttachmentTarget,
  type ContentAnchorTarget,
} from './anchor';

export interface WorkbenchSelectionSnapshot {
  readonly text: string;
  readonly target: ContentAnchorTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isWorkbenchSelectionSnapshot(
  value: unknown,
): value is WorkbenchSelectionSnapshot {
  if (!isRecord(value) || !isRequiredText(value.text)) {
    return false;
  }

  return (
    isAssetAttachmentTarget(value.target) &&
    value.target.scope === 'content'
  );
}
