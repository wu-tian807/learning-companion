import type { ConversationMessageContextSource } from '../../shared/project-conversations';
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

export interface OpenWorkbenchConversationInput {
  /** Present only when a Workbench explicitly attaches its provider/context. */
  readonly ownerId?: string;
  readonly conversationId?: string;
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
  private activeRegistration: ActiveRegistration | undefined;
  private launchId = 0;
  private revealAbortController: AbortController | undefined;
  private snapshot: WorkbenchConversationRuntimeSnapshot = Object.freeze({
    panelOpen: false,
    busy: false,
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
    this.activeRegistration = Object.freeze({
      token,
      ownerId: normalizedOwnerId,
      source,
    });
    this.update({ ...this.snapshot, active: source });

    return () => {
      queueMicrotask(() => {
        if (this.activeRegistration?.token !== token) return;
        this.activeRegistration = undefined;
        this.launchId += 1;
        this.update({
          panelOpen: this.snapshot.panelOpen,
          busy: this.snapshot.busy,
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
    const ownerId = input.ownerId?.trim();
    const registration = this.activeRegistration;
    if (ownerId && registration?.ownerId !== ownerId) {
      throw new Error('当前 Workbench 没有注册 AI 问答上下文');
    }
    if (input.context !== undefined && !ownerId) {
      throw new Error('AI 问答上下文没有已注册的来源');
    }

    const contextSource = ownerId ? registration?.source : undefined;
    this.launchId += 1;
    const launchRequest: ConversationLaunchRequest = Object.freeze({
      id: this.launchId,
      ...(input.conversationId?.trim()
        ? { conversationId: input.conversationId.trim() }
        : {}),
      ...(input.fallbackToNewConversation === true
        ? { fallbackToNewConversation: true }
        : {}),
      ...(contextSource
        ? { contextSource }
        : { clearContext: true }),
      ...(input.context === undefined ? {} : { context: input.context }),
      ...(input.question?.trim() ? { question: input.question.trim() } : {}),
      ...(input.submit === true ? { submit: true } : {}),
    });
    this.update({ ...this.snapshot, panelOpen: true, launchRequest });
  }

  close(): void {
    if (!this.snapshot.panelOpen) return;
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
    const active = this.activeRegistration?.source;
    return matchesSource(active, source) ? active.contribution : undefined;
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
    this.cancelReveal();
    this.activeRegistration = undefined;
    this.update({ panelOpen: false, busy: false });
    this.listeners.clear();
  }

  private cancelReveal(): void {
    this.revealAbortController?.abort(
      new DOMException('已切换到另一条引用。', 'AbortError'),
    );
    this.revealAbortController = undefined;
  }

  private update(next: WorkbenchConversationRuntimeSnapshot): void {
    if (
      this.snapshot.active === next.active &&
      this.snapshot.panelOpen === next.panelOpen &&
      this.snapshot.busy === next.busy &&
      this.snapshot.launchRequest === next.launchRequest
    ) {
      return;
    }
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }
}
