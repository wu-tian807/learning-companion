import type { AssetTarget } from '../../../shared/workbench/anchor';

export interface WorkbenchAnchorRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export const WORKBENCH_RESOLVE_ANCHOR_EVENT =
  'learning-companion:resolve-workbench-anchor';
export const WORKBENCH_REVEAL_ANCHOR_EVENT =
  'learning-companion:reveal-workbench-anchor';
export const WORKBENCH_RESOLVE_ANCHOR_PREVIEW_EVENT =
  'learning-companion:resolve-workbench-anchor-preview';
export const WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT =
  'learning-companion:workbench-anchor-layout-changed';

export interface ResolveWorkbenchAnchorDetail {
  readonly assetId: string;
  readonly target: AssetTarget;
  readonly respond: (rect: WorkbenchAnchorRect | undefined) => void;
}

export interface RevealWorkbenchAnchorDetail {
  readonly assetId: string;
  readonly target: AssetTarget;
}

export interface ResolveWorkbenchAnchorPreviewDetail {
  readonly assetId: string;
  readonly target: AssetTarget;
  readonly respond: (dataUrl: string | undefined) => void;
}

export function resolveWorkbenchAnchor(
  assetId: string,
  target: AssetTarget,
): WorkbenchAnchorRect | undefined {
  let result: WorkbenchAnchorRect | undefined;
  window.dispatchEvent(new CustomEvent<ResolveWorkbenchAnchorDetail>(
    WORKBENCH_RESOLVE_ANCHOR_EVENT,
    { detail: { assetId, target, respond: (rect) => { result = rect; } } },
  ));
  return result;
}

export function revealWorkbenchAnchor(
  assetId: string,
  target: AssetTarget,
): void {
  window.dispatchEvent(new CustomEvent<RevealWorkbenchAnchorDetail>(
    WORKBENCH_REVEAL_ANCHOR_EVENT,
    { detail: { assetId, target } },
  ));
}

export function resolveWorkbenchAnchorPreview(
  assetId: string,
  target: AssetTarget,
): string | undefined {
  let result: string | undefined;
  window.dispatchEvent(new CustomEvent<ResolveWorkbenchAnchorPreviewDetail>(
    WORKBENCH_RESOLVE_ANCHOR_PREVIEW_EVENT,
    { detail: { assetId, target, respond: (dataUrl) => { result = dataUrl; } } },
  ));
  return result;
}
