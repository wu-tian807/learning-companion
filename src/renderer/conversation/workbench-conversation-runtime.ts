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

export interface WorkbenchConversationPendingStart {
  readonly operationId: string;
  readonly conversationId: string;
  readonly startedRevision: number;
  readonly cancelRequested: boolean;
}

export interface WorkbenchConversationStartFailure {
  readonly operationId: string;
  readonly draft: string;
  readonly pendingContext?: JsonValue;
  readonly error: {
    readonly message: string;
    readonly code?: string;
    readonly retryTaskId?: string;
  };
}

export interface WorkbenchCurrentConversationState {
  readonly revision: number;
  readonly conversation: ConversationRecord;
  readonly pendingStart?: WorkbenchConversationPendingStart;
  readonly startFailure?: WorkbenchConversationStartFailure;
}

export interface BeginWorkbenchConversationStartInput {
  readonly operationId: string;
  readonly expectedConversationId: string;
  readonly conversation: ConversationRecord;
}

export interface ResolveWorkbenchConversationStartInput {
  readonly operationId: string;
  readonly taskId: string;
  readonly updateConversation: (
    current: ConversationRecord,
  ) => ConversationRecord | undefined;
}

export interface RejectWorkbenchConversationStartInput {
  readonly operationId: string;
  readonly draft: string;
  readonly pendingContext?: JsonValue;
  readonly error: WorkbenchConversationStartFailure['error'];
  readonly rollbackConversation: (
    current: ConversationRecord,
  ) => ConversationRecord;
}

export interface ResolvedWorkbenchConversationStart {
  readonly state: WorkbenchCurrentConversationState;
  readonly cancelRequested: boolean;
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
  private readonly currentConversations = new Map<
    string,
    WorkbenchCurrentConversationState
  >();
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
    return this.getCurrentConversationState(scope)?.conversation;
  }

  getCurrentConversationState(
    scope: WorkbenchConversationScope,
  ): WorkbenchCurrentConversationState | undefined {
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
  ): WorkbenchCurrentConversationState {
    this.validateConversation(conversation);
    const key = conversationScopeKey(scope);
    const current = this.currentConversations.get(key);
    if (current?.conversation === conversation) return current;
    const sameConversation = current?.conversation.id === conversation.id;
    const next: WorkbenchCurrentConversationState = Object.freeze({
      revision: (current?.revision ?? 0) + 1,
      conversation,
      ...(sameConversation && current?.pendingStart
        ? { pendingStart: current.pendingStart }
        : {}),
      ...(sameConversation && current?.startFailure
        ? { startFailure: current.startFailure }
        : {}),
    });
    this.setCurrentConversationState(key, next);
    return next;
  }

  beginCurrentConversationStart(
    scope: WorkbenchConversationScope,
    input: BeginWorkbenchConversationStartInput,
  ): WorkbenchCurrentConversationState | undefined {
    const operationId = input.operationId.trim();
    const expectedConversationId = input.expectedConversationId.trim();
    this.validateConversation(input.conversation);
    if (!operationId || !expectedConversationId) {
      throw new Error('Workbench Conversation operation 无效');
    }
    const key = conversationScopeKey(scope);
    const current = this.currentConversations.get(key);
    if (
      !current ||
      current.pendingStart ||
      current.conversation.id !== expectedConversationId ||
      input.conversation.id !== expectedConversationId
    ) {
      return undefined;
    }
    const revision = current.revision + 1;
    const next: WorkbenchCurrentConversationState = Object.freeze({
      revision,
      conversation: input.conversation,
      pendingStart: Object.freeze({
        operationId,
        conversationId: expectedConversationId,
        startedRevision: revision,
        cancelRequested: false,
      }),
    });
    this.setCurrentConversationState(key, next);
    return next;
  }

  resolveCurrentConversationStart(
    scope: WorkbenchConversationScope,
    input: ResolveWorkbenchConversationStartInput,
  ): ResolvedWorkbenchConversationStart | undefined {
    const operationId = input.operationId.trim();
    if (!operationId || !input.taskId.trim()) {
      throw new Error('Workbench Conversation operation 无效');
    }
    const key = conversationScopeKey(scope);
    const current = this.currentConversations.get(key);
    if (
      !current?.pendingStart ||
      current.pendingStart.operationId !== operationId ||
      current.conversation.id !== current.pendingStart.conversationId
    ) {
      return undefined;
    }
    const conversation = input.updateConversation(current.conversation);
    if (!conversation) {
      this.setCurrentConversationState(key, Object.freeze({
        revision: current.revision + 1,
        conversation: current.conversation,
      }));
      return undefined;
    }
    this.validateConversation(conversation);
    if (conversation.id !== current.conversation.id) {
      throw new Error('Workbench Conversation operation 不能切换 identity');
    }
    const next: WorkbenchCurrentConversationState = Object.freeze({
      revision: current.revision + 1,
      conversation,
    });
    this.setCurrentConversationState(key, next);
    return Object.freeze({
      state: next,
      cancelRequested: current.pendingStart.cancelRequested,
    });
  }

  rejectCurrentConversationStart(
    scope: WorkbenchConversationScope,
    input: RejectWorkbenchConversationStartInput,
  ): WorkbenchCurrentConversationState | undefined {
    const operationId = input.operationId.trim();
    if (!operationId || !input.error.message.trim()) {
      throw new Error('Workbench Conversation operation 无效');
    }
    const key = conversationScopeKey(scope);
    const current = this.currentConversations.get(key);
    if (
      !current?.pendingStart ||
      current.pendingStart.operationId !== operationId ||
      current.conversation.id !== current.pendingStart.conversationId
    ) {
      return undefined;
    }
    const conversation = input.rollbackConversation(current.conversation);
    this.validateConversation(conversation);
    if (conversation.id !== current.conversation.id) {
      throw new Error('Workbench Conversation operation 不能切换 identity');
    }
    const failure: WorkbenchConversationStartFailure = Object.freeze({
      operationId,
      draft: input.draft,
      ...(input.pendingContext === undefined
        ? {}
        : { pendingContext: input.pendingContext }),
      error: Object.freeze({ ...input.error }),
    });
    const next: WorkbenchCurrentConversationState = Object.freeze({
      revision: current.revision + 1,
      conversation,
      startFailure: failure,
    });
    this.setCurrentConversationState(key, next);
    return next;
  }

  requestCurrentConversationStartCancel(
    scope: WorkbenchConversationScope,
    operationId: string,
  ): WorkbenchCurrentConversationState | undefined {
    const normalizedOperationId = operationId.trim();
    if (!normalizedOperationId) {
      throw new Error('Workbench Conversation operation 无效');
    }
    const key = conversationScopeKey(scope);
    const current = this.currentConversations.get(key);
    if (
      !current?.pendingStart ||
      current.pendingStart.operationId !== normalizedOperationId
    ) {
      return undefined;
    }
    if (current.pendingStart.cancelRequested) return current;
    const next: WorkbenchCurrentConversationState = Object.freeze({
      ...current,
      revision: current.revision + 1,
      pendingStart: Object.freeze({
        ...current.pendingStart,
        cancelRequested: true,
      }),
    });
    this.setCurrentConversationState(key, next);
    return next;
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

  private validateConversation(conversation: ConversationRecord): void {
    if (!conversation.id.trim()) {
      throw new Error('Workbench Conversation identity 无效');
    }
  }

  private setCurrentConversationState(
    key: string,
    next: WorkbenchCurrentConversationState,
  ): void {
    this.currentConversations.set(key, next);
    for (const listener of [
      ...(this.currentConversationListeners.get(key) ?? []),
    ]) {
      listener();
    }
  }
}
