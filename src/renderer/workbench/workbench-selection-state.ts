import type { WorkbenchSelectionEnvelope } from '../../shared/workbench/selection';

export function reduceWorkbenchSelection(
  current: WorkbenchSelectionEnvelope | undefined,
  event: WorkbenchSelectionEnvelope,
  activeAssetId: string | undefined,
): WorkbenchSelectionEnvelope | undefined {
  if (event.assetId !== activeAssetId) {
    return current;
  }

  if (event.selection) {
    return event;
  }

  return current?.sessionId === event.sessionId ? undefined : current;
}
