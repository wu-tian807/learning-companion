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
  emphasize?(target: AssetTarget): void | Promise<void>;
}

interface Registration {
  readonly token: symbol;
  readonly assetId: string;
  readonly controller: WorkbenchTargetController;
}

const listeners = new Set<() => void>();
/**
 * Controllers are visual-instance registrations, not an Asset-global singleton.
 * The asset-only lookup remains as a legacy fallback while callers migrate to
 * an explicit owner (normally the source viewport/session).
 */
const registrationsByAsset = new Map<string, Map<string, Registration>>();
const latestOwnerByAsset = new Map<string, string>();

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
  const registration = { token, assetId: normalizedAssetId, controller };
  const registrations = registrationsByAsset.get(normalizedAssetId) ?? new Map();
  registrations.set(normalizedOwnerId, registration);
  registrationsByAsset.set(normalizedAssetId, registrations);
  latestOwnerByAsset.set(normalizedAssetId, normalizedOwnerId);
  publish();

  return () => {
    queueMicrotask(() => {
      const current = registrationsByAsset
        .get(normalizedAssetId)
        ?.get(normalizedOwnerId);
      if (current?.token !== token) return;
      const entries = registrationsByAsset.get(normalizedAssetId);
      entries?.delete(normalizedOwnerId);
      if (entries?.size === 0) registrationsByAsset.delete(normalizedAssetId);
      if (latestOwnerByAsset.get(normalizedAssetId) === normalizedOwnerId) {
        const replacement = entries?.keys().next().value as string | undefined;
        if (replacement) latestOwnerByAsset.set(normalizedAssetId, replacement);
        else latestOwnerByAsset.delete(normalizedAssetId);
      }
      publish();
    });
  };
}

function current(
  assetId: string,
  ownerId?: string,
): WorkbenchTargetController | undefined {
  const normalizedAssetId = assetId.trim();
  const normalizedOwnerId = ownerId?.trim();
  const registrations = registrationsByAsset.get(normalizedAssetId);
  const registration = normalizedOwnerId
    ? registrations?.get(normalizedOwnerId)
    : registrations?.get(latestOwnerByAsset.get(normalizedAssetId) ?? '');
  return registration?.controller;
}

export function resolveWorkbenchTarget(
  assetId: string,
  target: AssetTarget,
  ownerId?: string,
): WorkbenchTargetRect | undefined {
  return current(assetId, ownerId)?.resolve?.(target);
}

export function getWorkbenchTargetSourceRevision(
  assetId: string,
  ownerId?: string,
): string | undefined {
  return current(assetId, ownerId)?.sourceRevision;
}

export async function revealWorkbenchTarget(
  assetId: string,
  target: AssetTarget,
  sourceRevision?: string,
  emphasize = false,
  ownerId?: string,
): Promise<void> {
  const controller = current(assetId, ownerId);
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
  if (emphasize) await controller.emphasize?.(target);
}

export function waitForWorkbenchTargetController(
  assetId: string,
  signal: AbortSignal,
  timeoutMs = 10_000,
  ownerId?: string,
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (current(assetId, ownerId)) return Promise.resolve();
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
      if (current(assetId, ownerId)) finish();
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

export async function selectAndRevealWorkbenchTarget({
  assetId,
  target,
  sourceRevision,
  selectAsset,
  signal,
  timeoutMs,
  emphasize,
  ownerId,
}: {
  readonly assetId: string;
  readonly target: AssetTarget;
  readonly sourceRevision?: string;
  readonly selectAsset: (assetId: string) => Promise<void> | void;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly emphasize?: boolean;
  /** Source visual Workbench registration. Required by new multi-viewport callers. */
  readonly ownerId?: string;
}): Promise<void> {
  if (signal.aborted) throw signal.reason;
  await selectAsset(assetId);
  if (signal.aborted) throw signal.reason;
  if (target.scope === 'asset') return;
  await waitForWorkbenchTargetController(assetId, signal, timeoutMs, ownerId);
  if (signal.aborted) throw signal.reason;
  await revealWorkbenchTarget(assetId, target, sourceRevision, emphasize, ownerId);
}

export function resetWorkbenchTargetControllerForTests(): void {
  registrationsByAsset.clear();
  latestOwnerByAsset.clear();
  listeners.clear();
}
