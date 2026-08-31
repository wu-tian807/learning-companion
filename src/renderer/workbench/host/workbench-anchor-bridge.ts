import type { AssetTarget } from '../../../shared/workbench/anchor';

export interface WorkbenchAnchorRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export const WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT =
  'learning-companion:workbench-anchor-layout-changed';

export interface WorkbenchAnchorController {
  /** Current materialized content revision, when the Asset target uses one. */
  readonly sourceRevision?: string;
  resolve?(target: AssetTarget): WorkbenchAnchorRect | undefined;
  reveal(target: AssetTarget): boolean | void | Promise<boolean | void>;
}

interface Registration {
  readonly token: symbol;
  readonly assetId: string;
  readonly controller: WorkbenchAnchorController;
}

const listeners = new Set<() => void>();
let active: Registration | undefined;

function publish(): void {
  for (const listener of [...listeners]) listener();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT));
  }
}

export function registerWorkbenchAnchorController(
  ownerId: string,
  assetId: string,
  controller: WorkbenchAnchorController,
): () => void {
  const normalizedOwnerId = ownerId.trim();
  const normalizedAssetId = assetId.trim();
  if (!normalizedOwnerId || !normalizedAssetId) {
    throw new Error('Workbench Anchor controller 无效');
  }
  const token = Symbol(normalizedOwnerId);
  active = { token, assetId: normalizedAssetId, controller };
  publish();

  return () => {
    queueMicrotask(() => {
      if (active?.token !== token) return;
      active = undefined;
      publish();
    });
  };
}

function current(assetId: string): WorkbenchAnchorController | undefined {
  return active?.assetId === assetId.trim() ? active.controller : undefined;
}

export function resolveWorkbenchAnchor(
  assetId: string,
  target: AssetTarget,
): WorkbenchAnchorRect | undefined {
  return current(assetId)?.resolve?.(target);
}

export async function revealWorkbenchAnchor(
  assetId: string,
  target: AssetTarget,
  sourceRevision?: string,
): Promise<void> {
  const controller = current(assetId);
  if (!controller) throw new Error('目标资料尚未准备好，无法定位原文。');
  if (
    sourceRevision !== undefined &&
    controller.sourceRevision !== sourceRevision
  ) {
    throw new Error('引用的资料内容已更新，无法再定位原位置。');
  }
  if (await controller.reveal(target) === false) {
    throw new Error('原文内容可能已经变化，无法定位该引用。');
  }
}

export function waitForWorkbenchAnchorController(
  assetId: string,
  signal: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (current(assetId)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      listeners.delete(check);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (current(assetId)) finish();
    };
    const abort = () => finish(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException('引用定位已取消。', 'AbortError'),
    );
    const timer = setTimeout(
      () => finish(new Error('目标资料加载超时，无法定位原文。')),
      timeoutMs,
    );
    listeners.add(check);
    signal.addEventListener('abort', abort, { once: true });
    check();
  });
}

export function resetWorkbenchAnchorControllerForTests(): void {
  active = undefined;
  listeners.clear();
}
