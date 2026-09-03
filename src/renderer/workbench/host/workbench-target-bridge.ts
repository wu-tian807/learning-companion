import type { AssetTarget } from '../../../shared/workbench/asset-target';

export interface WorkbenchTargetRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export const WORKBENCH_TARGET_LAYOUT_CHANGED_EVENT =
  'learning-companion:workbench-target-layout-changed';

export interface WorkbenchTargetController {
  /** Current materialized content revision, when the Asset target uses one. */
  readonly sourceRevision?: string;
  resolve?(target: AssetTarget): WorkbenchTargetRect | undefined;
  reveal(target: AssetTarget): boolean | void | Promise<boolean | void>;
}

interface Registration {
  readonly token: symbol;
  readonly assetId: string;
  readonly controller: WorkbenchTargetController;
}

const listeners = new Set<() => void>();
let active: Registration | undefined;

function publish(): void {
  for (const listener of [...listeners]) listener();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(WORKBENCH_TARGET_LAYOUT_CHANGED_EVENT));
  }
}

export function registerWorkbenchTargetController(
  ownerId: string,
  assetId: string,
  controller: WorkbenchTargetController,
): () => void {
  const normalizedOwnerId = ownerId.trim();
  const normalizedAssetId = assetId.trim();
  if (!normalizedOwnerId || !normalizedAssetId) {
    throw new Error('Workbench Target controller 无效');
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

function current(assetId: string): WorkbenchTargetController | undefined {
  return active?.assetId === assetId.trim() ? active.controller : undefined;
}

export function resolveWorkbenchTarget(
  assetId: string,
  target: AssetTarget,
): WorkbenchTargetRect | undefined {
  return current(assetId)?.resolve?.(target);
}

export async function revealWorkbenchTarget(
  assetId: string,
  target: AssetTarget,
  sourceRevision?: string,
): Promise<void> {
  const controller = current(assetId);
  if (!controller) throw new Error('目标资料尚未准备好，无法定位原文。');
  // Selecting the Asset already reveals an asset-scoped Target. It has no
  // content position whose revision could become stale.
  if (target.scope === 'asset') return;
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

export function waitForWorkbenchTargetController(
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

export function resetWorkbenchTargetControllerForTests(): void {
  active = undefined;
  listeners.clear();
}
