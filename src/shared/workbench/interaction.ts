import {
  isAssetAttachmentTarget,
  type ContentAnchorTarget,
} from './anchor';
import {
  isWorkbenchSelectionSnapshot,
  type WorkbenchSelectionSnapshot,
} from './selection';

export const workbenchInvocationOrigins = [
  'overflow',
  'context-menu',
  'generation-center',
] as const;

export type WorkbenchInvocationOrigin =
  (typeof workbenchInvocationOrigins)[number];

export interface WorkbenchInteractionSnapshot {
  readonly target?: ContentAnchorTarget;
  readonly selection?: WorkbenchSelectionSnapshot;
}

export interface WorkbenchInteractionContext
  extends WorkbenchInteractionSnapshot {
  readonly projectId: string;
  readonly assetId: string;
  readonly workbenchId: string;
  readonly sessionId: string;
}

export interface WorkbenchInvocationContext
  extends WorkbenchInteractionContext {
  readonly origin: WorkbenchInvocationOrigin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isWorkbenchInvocationOrigin(
  value: unknown,
): value is WorkbenchInvocationOrigin {
  return (
    typeof value === 'string' &&
    workbenchInvocationOrigins.includes(
      value as WorkbenchInvocationOrigin,
    )
  );
}

export function isWorkbenchInteractionSnapshot(
  value: unknown,
): value is WorkbenchInteractionSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.target === undefined ||
      (isAssetAttachmentTarget(value.target) &&
        value.target.scope === 'content')) &&
    (value.selection === undefined ||
      isWorkbenchSelectionSnapshot(value.selection))
  );
}

export function isWorkbenchInteractionContext(
  value: unknown,
): value is WorkbenchInteractionContext {
  if (!isRecord(value) || !isWorkbenchInteractionSnapshot(value)) {
    return false;
  }

  return (
    isRequiredText(value.projectId) &&
    isRequiredText(value.assetId) &&
    isRequiredText(value.workbenchId) &&
    isRequiredText(value.sessionId)
  );
}

export function isWorkbenchInvocationContext(
  value: unknown,
): value is WorkbenchInvocationContext {
  if (!isRecord(value) || !isWorkbenchInteractionContext(value)) {
    return false;
  }

  return (
    isWorkbenchInvocationOrigin(value.origin)
  );
}
