import {
  isAssetAttachmentTarget,
  type ContentAnchorTarget,
} from './anchor';

export interface WorkbenchSelectionSnapshot {
  readonly text: string;
  readonly target: ContentAnchorTarget;
}

export interface WorkbenchSelectionEnvelope {
  readonly assetId: string;
  readonly sessionId: string;
  readonly selection: WorkbenchSelectionSnapshot | undefined;
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

export function isWorkbenchSelectionEnvelope(
  value: unknown,
): value is WorkbenchSelectionEnvelope {
  return (
    isRecord(value) &&
    isRequiredText(value.assetId) &&
    isRequiredText(value.sessionId) &&
    (value.selection === undefined ||
      isWorkbenchSelectionSnapshot(value.selection))
  );
}
