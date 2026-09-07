import type { ConversationMessageContextSource } from '../../shared/project-conversations';
import { PROJECT_CONVERSATION_MODE_ID } from '../../shared/project-conversations';
import type { JsonValue } from '../../shared/workbench/protocol';
import {
  revealWorkbenchTarget,
  waitForWorkbenchTargetController,
} from '../workbench/host/workbench-target-bridge';
import type {
  ActiveWorkbenchConversationContribution,
  ConversationLaunchRequest,
  WorkbenchConversationContribution,
  WorkbenchConversationRuntimeSnapshot,
} from './conversation-contracts';
import {
  conversationContextSourceRevision,
  conversationContextTarget,
} from './conversation-reference';

interface ActiveRegistration {
  readonly token: symbol;
  readonly ownerId: string;
  readonly source: ActiveWorkbenchConversationContribution;
}

interface PendingLaunch {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const OPEN_LAUNCH_TIMEOUT_MS = 10_000;

export interface OpenWorkbenchConversationInput {
  /** Present only when a Workbench explicitly attaches its provider/context. */
  readonly ownerId?: string;
  readonly conversationId?: string;
  readonly modeId?: string;
  readonly boundAssetId?: string;
  readonly fallbackToNewConversation?: boolean;
  readonly context?: JsonValue;
  readonly question?: string;
  readonly submit?: boolean;
}

function matchesSource(
  active: ActiveWorkbenchConversationContribution | undefined,
  source: ConversationMessageContextSource | undefined,
): active is ActiveWorkbenchConversationContribution {
  return Boolean(
    active &&
    source?.assetId === active.assetId &&
    source.contextProviderId === active.contribution.contextProviderId,
  );
}

export class WorkbenchConversationRuntime {
  private readonly listeners = new Set<() => void>();
  private readonly pendingLaunches = new Map<number, PendingLaunch>();
  private activeRegistration: ActiveRegistration | undefined;
  /** All mounted Workbench sources, keyed by their visual owner. */
  private readonly registrations = new Map<string, ActiveRegistration>();
  private launchId = 0;
  private revealAbortController: AbortController | undefined;
  private snapshot: WorkbenchConversationRuntimeSnapshot = Object.freeze({
    panelOpen: false,
    busy: false,
    modeId: PROJECT_CONVERSATION_MODE_ID,
  });

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WorkbenchConversationRuntimeSnapshot => this.snapshot;

  register(
    ownerId: string,
    assetId: string,
    contribution: WorkbenchConversationContribution,
  ): () => void {
    const normalizedOwnerId = ownerId.trim();
    const normalizedAssetId = assetId.trim();
    if (
      !normalizedOwnerId ||
      !normalizedAssetId ||
      !contribution.contextProviderId.trim()
    ) {
      throw new Error('Workbench Conversation context contribution 无效');
    }

    const token = Symbol(normalizedOwnerId);
    const source = Object.freeze({
      assetId: normalizedAssetId,
      contribution,
    });
    const registration = Object.freeze({
      token,
      ownerId: normalizedOwnerId,
      source,
    });
    this.registrations.set(normalizedOwnerId, registration);
    this.activeRegistration = registration;
    this.update({ ...this.snapshot, active: source });

    return () => {
      queueMicrotask(() => {
        if (this.registrations.get(normalizedOwnerId)?.token !== token) return;
        this.registrations.delete(normalizedOwnerId);
        const wasActive = this.activeRegistration?.token === token;
        if (!wasActive) return;
        this.activeRegistration = [...this.registrations.values()].at(-1);
        this.rejectPendingLaunches('AI 问答来源已关闭。');
        this.launchId += 1;
        this.update({
          panelOpen: this.snapshot.panelOpen,
          busy: this.snapshot.busy,
          ...(this.activeRegistration
            ? { active: this.activeRegistration.source }
            : {}),
          ...(this.snapshot.modeId ? { modeId: this.snapshot.modeId } : {}),
          ...(this.snapshot.boundAssetId
            ? { boundAssetId: this.snapshot.boundAssetId }
            : {}),
          ...(this.snapshot.panelOpen
            ? {
                launchRequest: Object.freeze({
                  id: this.launchId,
                  clearContext: true,
                }),
              }
            : {}),
        });
      });
    };
  }

  open(input: OpenWorkbenchConversationInput = {}): void {
    this.openInternal(input);
  }

  /** Opens the panel and waits until ConversationSession accepts the request. */
  openAndWait(input: OpenWorkbenchConversationInput = {}): Promise<void> {
    let resolvePending: (() => void) | undefined;
    let rejectPending: ((error: unknown) => void) | undefined;
    const completion = new Promise<void>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });

    try {
      const pending: PendingLaunch = {
        resolve: resolvePending!,
        reject: rejectPending!,
      };
      this.openInternal(input, pending);
      pending.timer = setTimeout(() => {
        const requestId = this.launchId;
        this.settleLaunchRequest(
          requestId,
          new Error('AI 问答面板打开超时，请重试。'),
        );
      }, OPEN_LAUNCH_TIMEOUT_MS);
    } catch (error: unknown) {
      rejectPending!(error);
    }
    return completion;
  }

  settleLaunchRequest(requestId: number, error?: unknown): void {
    const pending = this.pendingLaunches.get(requestId);
    if (!pending) return;
    this.pendingLaunches.delete(requestId);
    if (pending.timer) clearTimeout(pending.timer);
    if (error === undefined) pending.resolve();
    else pending.reject(error);
  }

  private openInternal(
    input: OpenWorkbenchConversationInput,
    pending?: PendingLaunch,
  ): void {
    const ownerId = input.ownerId?.trim();
    const registration = ownerId
      ? this.registrations.get(ownerId)
      : this.activeRegistration;
    if (ownerId && registration?.ownerId !== ownerId) {
      throw new Error('当前 Workbench 没有注册 AI 问答上下文');
    }
    if (input.context !== undefined && !ownerId) {
      throw new Error('AI 问答上下文没有已注册的来源');
    }

    const contextSource = ownerId ? registration?.source : undefined;
    const explicitIdentity = Boolean(
      input.modeId?.trim() ||
      input.boundAssetId?.trim() ||
      input.conversationId?.trim(),
    );
    const preserveCurrentIdentity =
      !explicitIdentity &&
      (input.context !== undefined ||
        input.fallbackToNewConversation === true) &&
      this.snapshot.modeId !== undefined;
    const modeId =
      input.modeId?.trim() ||
      (preserveCurrentIdentity
        ? this.snapshot.modeId!
        : PROJECT_CONVERSATION_MODE_ID);
    const boundAssetId =
      input.boundAssetId?.trim() ||
      (preserveCurrentIdentity ? this.snapshot.boundAssetId : undefined);
    const conversationId =
      input.conversationId?.trim() ||
      (!input.fallbackToNewConversation && preserveCurrentIdentity
        ? this.snapshot.conversationId
        : undefined);

    this.rejectPendingLaunches('AI 问答打开请求已被新的请求替换。');
    this.launchId += 1;
    if (pending) this.pendingLaunches.set(this.launchId, pending);
    const launchRequest: ConversationLaunchRequest = Object.freeze({
      id: this.launchId,
      modeId,
      ...(boundAssetId ? { boundAssetId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(input.fallbackToNewConversation === true
        ? { fallbackToNewConversation: true }
        : {}),
      ...(contextSource ? { contextSource } : { clearContext: true }),
      ...(input.context === undefined ? {} : { context: input.context }),
      ...(input.question?.trim() ? { question: input.question.trim() } : {}),
      ...(input.submit === true ? { submit: true } : {}),
    });
    this.update({
      ...this.snapshot,
      panelOpen: true,
      modeId,
      ...(boundAssetId
        ? { boundAssetId }
        : modeId === PROJECT_CONVERSATION_MODE_ID
          ? { boundAssetId: undefined }
          : {}),
      ...(conversationId ? { conversationId } : {}),
      launchRequest,
    });
  }

  setConversationIdentity(conversationId: string | undefined): void {
    const normalized = conversationId?.trim();
    const next = normalized ? normalized : undefined;
    if (this.snapshot.conversationId === next) return;
    this.update({
      ...this.snapshot,
      ...(next ? { conversationId: next } : { conversationId: undefined }),
    });
  }

  close(): void {
    if (!this.snapshot.panelOpen) return;
    this.rejectPendingLaunches('AI 问答面板已关闭。');
    this.cancelReveal();
    this.update({ ...this.snapshot, panelOpen: false });
  }

  consumeLaunchRequest(requestId: number): void {
    if (this.snapshot.launchRequest?.id !== requestId) return;
    this.update({ ...this.snapshot, launchRequest: undefined });
  }

  setBusy(busy: boolean): void {
    if (this.snapshot.busy === busy) return;
    this.update({ ...this.snapshot, busy });
  }

  resolveContribution(
    source: ConversationMessageContextSource | undefined,
  ): WorkbenchConversationContribution | undefined {
    if (!source) return undefined;
    for (const registration of this.registrations.values()) {
      if (matchesSource(registration.source, source)) {
        return registration.source.contribution;
      }
    }
    return undefined;
  }

  async revealContext(
    source: ConversationMessageContextSource,
    context: JsonValue,
    selectAsset: (assetId: string) => Promise<void> | void,
    timeoutMs = 10_000,
  ): Promise<void> {
    if (!source.assetId) {
      throw new Error('这条引用没有关联资料，无法定位原文。');
    }
    const target = conversationContextTarget(context);
    if (!target) {
      throw new Error('这条引用没有有效 Target，无法定位原文。');
    }
    this.cancelReveal();
    const controller = new AbortController();
    this.revealAbortController = controller;
    try {
      await selectAsset(source.assetId);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (target.scope === 'asset') return;
      await waitForWorkbenchTargetController(
        source.assetId,
        controller.signal,
        timeoutMs,
      );
      if (controller.signal.aborted) throw controller.signal.reason;
      await revealWorkbenchTarget(
        source.assetId,
        target,
        conversationContextSourceRevision(context),
      );
    } finally {
      if (this.revealAbortController === controller) {
        this.revealAbortController = undefined;
      }
    }
  }

  dispose(): void {
    this.rejectPendingLaunches('AI 问答面板已关闭。');
    this.cancelReveal();
    this.activeRegistration = undefined;
    this.registrations.clear();
    this.update({ panelOpen: false, busy: false });
    this.listeners.clear();
  }

  private cancelReveal(): void {
    this.revealAbortController?.abort(
      new DOMException('已切换到另一条引用。', 'AbortError'),
    );
    this.revealAbortController = undefined;
  }

  private rejectPendingLaunches(message: string): void {
    for (const [requestId, pending] of this.pendingLaunches) {
      this.pendingLaunches.delete(requestId);
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
  }

  private update(next: WorkbenchConversationRuntimeSnapshot): void {
    if (
      this.snapshot.active === next.active &&
      this.snapshot.panelOpen === next.panelOpen &&
      this.snapshot.busy === next.busy &&
      this.snapshot.modeId === next.modeId &&
      this.snapshot.boundAssetId === next.boundAssetId &&
      this.snapshot.conversationId === next.conversationId &&
      this.snapshot.launchRequest === next.launchRequest
    ) {
      return;
    }
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }
}
