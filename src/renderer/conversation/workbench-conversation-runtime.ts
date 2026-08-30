import type { ConversationMessageContextSource } from '../../shared/project-conversations';
import type { JsonValue } from '../../shared/workbench/protocol';
import type {
  ActiveWorkbenchConversationContribution,
  ConversationLaunchRequest,
  WorkbenchConversationContribution,
  WorkbenchConversationRuntimeSnapshot,
} from './conversation-contracts';

interface RegisteredContribution {
  readonly token: symbol;
  readonly assetId: string;
  readonly contribution: WorkbenchConversationContribution;
}

export interface OpenWorkbenchConversationInput {
  /** Optional Workbench context source for this launch; omitted means Project chat. */
  readonly ownerId?: string;
  readonly conversationId?: string;
  readonly fallbackToNewConversation?: boolean;
  readonly context?: JsonValue;
  readonly question?: string;
  readonly submit?: boolean;
}

function activeContextSource(
  ownerId: string,
  registered: RegisteredContribution,
): ActiveWorkbenchConversationContribution {
  return Object.freeze({
    ownerId,
    assetId: registered.assetId,
    contribution: registered.contribution,
  });
}

export class WorkbenchConversationRuntime {
  private readonly listeners = new Set<() => void>();
  private readonly contributions = new Map<string, RegisteredContribution>();
  private launchId = 0;
  private snapshot: WorkbenchConversationRuntimeSnapshot = Object.freeze({
    panelOpen: false,
    busy: false,
    registryRevision: 0,
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
      !contribution.id.trim() ||
      !contribution.workbenchId.trim() ||
      !contribution.contextProviderId.trim()
    ) {
      throw new Error('Workbench Conversation context contribution 无效');
    }
    const token = Symbol(normalizedOwnerId);
    const registered = Object.freeze({
      token,
      assetId: normalizedAssetId,
      contribution,
    });
    this.contributions.set(normalizedOwnerId, registered);

    const current = this.snapshot.contextSource;
    this.update({
      ...this.snapshot,
      registryRevision: this.snapshot.registryRevision + 1,
      ...(current?.ownerId === normalizedOwnerId
        ? {
            contextSource: activeContextSource(
              normalizedOwnerId,
              registered,
            ),
          }
        : {}),
    });

    return () => {
      queueMicrotask(() => {
        const currentRegistration = this.contributions.get(normalizedOwnerId);
        if (currentRegistration?.token !== token) return;
        this.contributions.delete(normalizedOwnerId);

        if (this.snapshot.contextSource?.ownerId !== normalizedOwnerId) {
          this.update({
            ...this.snapshot,
            registryRevision: this.snapshot.registryRevision + 1,
          });
          return;
        }

        this.launchId += 1;
        this.update({
          panelOpen: this.snapshot.panelOpen,
          busy: this.snapshot.busy,
          registryRevision: this.snapshot.registryRevision + 1,
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
    const normalizedOwnerId = input.ownerId?.trim();
    const registered = normalizedOwnerId
      ? this.contributions.get(normalizedOwnerId)
      : undefined;
    if (normalizedOwnerId && !registered) {
      throw new Error('当前 Workbench 没有注册 AI 问答上下文');
    }
    if (input.context !== undefined && !registered) {
      throw new Error('AI 问答上下文没有已注册的来源');
    }

    const contextSource =
      normalizedOwnerId && registered
        ? activeContextSource(normalizedOwnerId, registered)
        : undefined;
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
    this.update({
      panelOpen: true,
      busy: this.snapshot.busy,
      registryRevision: this.snapshot.registryRevision,
      ...(contextSource ? { contextSource } : {}),
      launchRequest,
    });
  }

  close(): void {
    if (!this.snapshot.panelOpen) return;
    this.update({
      panelOpen: false,
      busy: this.snapshot.busy,
      registryRevision: this.snapshot.registryRevision,
    });
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
    if (!source?.assetId) return undefined;
    for (const registered of this.contributions.values()) {
      if (
        registered.assetId === source.assetId &&
        registered.contribution.id === source.contributionId &&
        registered.contribution.contextProviderId ===
          source.contextProviderId
      ) {
        return registered.contribution;
      }
    }
    return undefined;
  }

  dispose(): void {
    this.contributions.clear();
    this.update({
      panelOpen: false,
      busy: false,
      registryRevision: this.snapshot.registryRevision + 1,
    });
    this.listeners.clear();
  }

  private update(next: WorkbenchConversationRuntimeSnapshot): void {
    if (
      this.snapshot.contextSource?.ownerId ===
        next.contextSource?.ownerId &&
      this.snapshot.contextSource?.assetId ===
        next.contextSource?.assetId &&
      this.snapshot.contextSource?.contribution ===
        next.contextSource?.contribution &&
      this.snapshot.panelOpen === next.panelOpen &&
      this.snapshot.busy === next.busy &&
      this.snapshot.registryRevision === next.registryRevision &&
      this.snapshot.launchRequest === next.launchRequest
    ) {
      return;
    }
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }
}
