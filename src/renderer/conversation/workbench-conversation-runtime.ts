import type { JsonValue } from '../../shared/workbench/protocol';
import type {
  ConversationLaunchRequest,
  ConversationRecord,
  WorkbenchConversationContribution,
  WorkbenchConversationRuntimeSnapshot,
} from './conversation-contracts';

interface RegisteredContribution {
  readonly token: symbol;
  readonly contribution: WorkbenchConversationContribution;
}

export interface WorkbenchConversationScope {
  readonly projectId: string;
  readonly assetId: string;
  readonly contributionId: string;
  readonly conversationPartitionKey?: string;
}

function conversationScopeKey(scope: WorkbenchConversationScope): string {
  const identityParts = [scope.projectId, scope.assetId, scope.contributionId]
    .map((part) => part.trim());
  if (
    identityParts.some((part) => part.length === 0) ||
    (scope.conversationPartitionKey !== undefined &&
      scope.conversationPartitionKey.trim().length === 0)
  ) {
    throw new Error('Workbench Conversation scope 无效');
  }
  return JSON.stringify([
    ...identityParts,
    scope.conversationPartitionKey ?? null,
  ]);
}

export interface OpenWorkbenchConversationInput {
  readonly ownerId?: string;
  /** Only set when the user explicitly restores a persisted UI history entry. */
  readonly conversationId?: string;
  readonly fallbackToNewConversation?: boolean;
  readonly context?: JsonValue;
  readonly question?: string;
  readonly submit?: boolean;
}

export class WorkbenchConversationRuntime {
  private readonly listeners = new Set<() => void>();
  private readonly contributions = new Map<string, RegisteredContribution>();
  private readonly currentConversations = new Map<string, ConversationRecord>();
  private readonly currentConversationListeners = new Map<
    string,
    Set<() => void>
  >();
  private launchId = 0;
  private snapshot: WorkbenchConversationRuntimeSnapshot = Object.freeze({
    panelOpen: false,
    busy: false,
  });

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WorkbenchConversationRuntimeSnapshot => this.snapshot;

  getCurrentConversation(
    scope: WorkbenchConversationScope,
  ): ConversationRecord | undefined {
    return this.currentConversations.get(conversationScopeKey(scope));
  }

  subscribeCurrentConversation(
    scope: WorkbenchConversationScope,
    listener: () => void,
  ): () => void {
    const key = conversationScopeKey(scope);
    const listeners = this.currentConversationListeners.get(key) ?? new Set();
    listeners.add(listener);
    this.currentConversationListeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.currentConversationListeners.delete(key);
      }
    };
  }

  setCurrentConversation(
    scope: WorkbenchConversationScope,
    conversation: ConversationRecord,
  ): void {
    if (!conversation.id.trim()) {
      throw new Error('Workbench Conversation identity 无效');
    }
    const key = conversationScopeKey(scope);
    if (this.currentConversations.get(key) === conversation) return;
    this.currentConversations.set(key, conversation);
    for (const listener of [
      ...(this.currentConversationListeners.get(key) ?? []),
    ]) {
      listener();
    }
  }

  register(
    ownerId: string,
    contribution: WorkbenchConversationContribution,
  ): () => void {
    const normalizedOwnerId = ownerId.trim();
    if (
      !normalizedOwnerId ||
      !contribution.id.trim() ||
      !contribution.workbenchId.trim()
    ) {
      throw new Error('Workbench Conversation contribution 无效');
    }
    const token = Symbol(normalizedOwnerId);
    const ownerChanged = this.snapshot.active?.ownerId !== normalizedOwnerId;
    this.contributions.delete(normalizedOwnerId);
    this.contributions.set(normalizedOwnerId, { token, contribution });
    this.update({
      ...this.snapshot,
      active: { ownerId: normalizedOwnerId, contribution },
      panelOpen: ownerChanged ? false : this.snapshot.panelOpen,
      busy: ownerChanged ? false : this.snapshot.busy,
      ...(ownerChanged ? { launchRequest: undefined } : {}),
    });

    return () => {
      queueMicrotask(() => {
        const current = this.contributions.get(normalizedOwnerId);
        if (current?.token !== token) return;
        this.contributions.delete(normalizedOwnerId);
        if (this.snapshot.active?.ownerId !== normalizedOwnerId) return;
        const fallback = [...this.contributions.entries()].at(-1);
        this.update({
          panelOpen: false,
          busy: false,
          ...(fallback
            ? {
                active: {
                  ownerId: fallback[0],
                  contribution: fallback[1].contribution,
                },
              }
            : {}),
        });
      });
    };
  }

  open(input: OpenWorkbenchConversationInput = {}): void {
    const active = input.ownerId
      ? this.contributions.get(input.ownerId)?.contribution
      : this.snapshot.active?.contribution;
    if (!active) {
      throw new Error('当前 Workbench 没有注册 AI 问答能力');
    }
    const ownerId = input.ownerId ?? this.snapshot.active!.ownerId;
    this.launchId += 1;
    const launchRequest: ConversationLaunchRequest = Object.freeze({
      id: this.launchId,
      ...(input.conversationId?.trim()
        ? { conversationId: input.conversationId.trim() }
        : {}),
      ...(input.fallbackToNewConversation === true
        ? { fallbackToNewConversation: true }
        : {}),
      ...(input.context === undefined ? {} : { context: input.context }),
      ...(input.question?.trim() ? { question: input.question.trim() } : {}),
      ...(input.submit === true ? { submit: true } : {}),
    });
    this.update({
      active: { ownerId, contribution: active },
      panelOpen: true,
      busy: this.snapshot.busy,
      launchRequest,
    });
  }

  close(): void {
    if (!this.snapshot.panelOpen) return;
    this.update({ ...this.snapshot, panelOpen: false, launchRequest: undefined });
  }

  consumeLaunchRequest(requestId: number): void {
    if (this.snapshot.launchRequest?.id !== requestId) return;
    this.update({ ...this.snapshot, launchRequest: undefined });
  }

  setBusy(ownerId: string, busy: boolean): void {
    if (
      this.snapshot.active?.ownerId !== ownerId ||
      this.snapshot.busy === busy
    ) {
      return;
    }
    this.update({ ...this.snapshot, busy });
  }

  dispose(): void {
    this.contributions.clear();
    this.currentConversations.clear();
    for (const listeners of this.currentConversationListeners.values()) {
      for (const listener of [...listeners]) listener();
    }
    this.currentConversationListeners.clear();
    this.update({ panelOpen: false, busy: false });
    this.listeners.clear();
  }

  private update(next: WorkbenchConversationRuntimeSnapshot): void {
    if (
      this.snapshot.active?.ownerId === next.active?.ownerId &&
      this.snapshot.active?.contribution === next.active?.contribution &&
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
