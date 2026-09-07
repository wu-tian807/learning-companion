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
  /**
   * A controller owns its native navigation state, but must observe this
   * signal before committing an asynchronous scroll/selection change.
   */
  reveal(
    target: AssetTarget,
    options?: WorkbenchTargetOperationOptions,
  ): boolean | void | Promise<boolean | void>;
  emphasize?(
    target: AssetTarget,
    options?: WorkbenchTargetOperationOptions,
  ): void | Promise<void>;
}

export interface WorkbenchTargetOperationOptions {
  readonly signal?: AbortSignal;
}

interface Registration {
  readonly token: symbol;
  readonly assetId: string;
  readonly controller: WorkbenchTargetController;
  readonly viewportId?: string;
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
  viewportId?: string,
): () => void {
  const normalizedOwnerId = ownerId.trim();
  const normalizedAssetId = assetId.trim();
  if (!normalizedOwnerId || !normalizedAssetId) {
    throw new Error('Workbench Target controller 无效');
  }
  const token = Symbol(normalizedOwnerId);
  const registration = {
    token,
    assetId: normalizedAssetId,
    controller,
    ...(viewportId?.trim() ? { viewportId: viewportId.trim() } : {}),
  };
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

function currentRegistration(
  assetId: string,
  ownerId?: string,
  viewportId?: string,
): Registration | undefined {
  const normalizedAssetId = assetId.trim();
  const normalizedOwnerId = ownerId?.trim();
  const registrations = registrationsByAsset.get(normalizedAssetId);
  const registration = normalizedOwnerId
    ? registrations?.get(normalizedOwnerId)
    : viewportId
      ? [...(registrations?.values() ?? [])]
          .reverse()
          .find((candidate) => candidate.viewportId === viewportId)
      : registrations?.get(latestOwnerByAsset.get(normalizedAssetId) ?? '');
  return registration;
}

function current(
  assetId: string,
  ownerId?: string,
): WorkbenchTargetController | undefined {
  return currentRegistration(assetId, ownerId)?.controller;
}

function throwIfCancelled(
  signal: AbortSignal | undefined,
  expectedRegistration: Registration,
  assetId: string,
  ownerId: string | undefined,
  viewportId?: string,
): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('引用定位已取消。', 'AbortError');
  }
  if (
    currentRegistration(assetId, ownerId, viewportId)?.token !==
    expectedRegistration.token
  ) {
    throw new DOMException('目标资料视口已关闭或被替换。', 'AbortError');
  }
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
  signal?: AbortSignal,
  viewportId?: string,
): Promise<void> {
  const registration = currentRegistration(assetId, ownerId, viewportId);
  const controller = registration?.controller;
  if (!registration || !controller) {
    throw new Error('目标资料尚未准备好，无法定位原文。');
  }
  throwIfCancelled(signal, registration, assetId, ownerId, viewportId);
  // Selecting the Asset already reveals an asset-scoped Target. It has no
  // content position whose revision could become stale.
  if (target.scope === 'asset') return;
  if (
    sourceRevision !== undefined &&
    controller.sourceRevision !== sourceRevision
  ) {
    throw new Error('引用的资料内容已更新，无法再定位原位置。');
  }
  const revealResult = signal
    ? await controller.reveal(target, { signal })
    : await controller.reveal(target);
  if (revealResult === false) {
    throw new Error('原文内容可能已经变化，无法定位该引用。');
  }
  throwIfCancelled(signal, registration, assetId, ownerId, viewportId);
  if (emphasize) {
    if (signal) await controller.emphasize?.(target, { signal });
    else await controller.emphasize?.(target);
    throwIfCancelled(signal, registration, assetId, ownerId, viewportId);
  }
}

export function waitForWorkbenchTargetController(
  assetId: string,
  signal: AbortSignal,
  timeoutMs = 10_000,
  ownerId?: string,
  viewportId?: string,
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (currentRegistration(assetId, ownerId, viewportId)) return Promise.resolve();
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
      if (currentRegistration(assetId, ownerId, viewportId)) finish();
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
  viewportId,
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
  readonly viewportId?: string;
}): Promise<void> {
  if (signal.aborted) throw signal.reason;
  await selectAsset(assetId);
  if (signal.aborted) throw signal.reason;
  if (target.scope === 'asset') return;
  await waitForWorkbenchTargetController(
    assetId,
    signal,
    timeoutMs,
    ownerId,
    viewportId,
  );
  if (signal.aborted) throw signal.reason;
  await revealWorkbenchTarget(
    assetId,
    target,
    sourceRevision,
    emphasize,
    ownerId,
    signal,
    viewportId,
  );
}

export function resetWorkbenchTargetControllerForTests(): void {
  registrationsByAsset.clear();
  latestOwnerByAsset.clear();
  listeners.clear();
}
