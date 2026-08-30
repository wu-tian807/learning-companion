import type { ConversationMessageContextSource } from '../../shared/project-conversations';
import type { JsonValue } from '../../shared/workbench/protocol';
import type {
  ActiveWorkbenchConversationContribution,
  ConversationContextPresentation,
  ConversationLaunchRequest,
  WorkbenchConversationContribution,
  WorkbenchConversationRuntimeSnapshot,
} from './conversation-contracts';

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
      source.contributionId === active.contribution.id &&
      source.contextProviderId === active.contribution.contextProviderId,
  );
}

export class WorkbenchConversationRuntime {
  private readonly listeners = new Set<() => void>();
  private activeRegistration: ActiveRegistration | undefined;
  private launchId = 0;
  private revealId = 0;
  private disposed = false;
  private snapshot: WorkbenchConversationRuntimeSnapshot = Object.freeze({
    panelOpen: false,
    busy: false,
  });

  constructor(
    private readonly describePersistedContext: (
      source: ConversationMessageContextSource,
      context: JsonValue,
    ) => ConversationContextPresentation | undefined = () => undefined,
  ) {}

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
    this.revealId += 1;
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

  describeContext(
    source: ConversationMessageContextSource,
    context: JsonValue,
  ): ConversationContextPresentation | undefined {
    return (
      this.describePersistedContext(source, context) ??
      this.resolveContribution(source)?.describeContext?.(context)
    );
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
    const revealId = ++this.revealId;
    await selectAsset(source.assetId);
    const contribution = await this.waitForContribution(
      source,
      revealId,
      timeoutMs,
    );
    if (revealId !== this.revealId) {
      throw new DOMException('已切换到另一条引用。', 'AbortError');
    }
    if (!contribution.revealContext) {
      throw new Error('目标资料不支持定位这条引用。');
    }
    if (contribution.isContext && !contribution.isContext(context)) {
      throw new Error('引用的资料内容已更新，无法再定位原位置。');
    }
    await contribution.revealContext(context);
  }

  dispose(): void {
    this.disposed = true;
    this.revealId += 1;
    this.activeRegistration = undefined;
    this.update({ panelOpen: false, busy: false });
    this.listeners.clear();
  }

  private waitForContribution(
    source: ConversationMessageContextSource,
    revealId: number,
    timeoutMs: number,
  ): Promise<WorkbenchConversationContribution> {
    const resolved = this.resolveContribution(source);
    if (resolved) return Promise.resolve(resolved);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (
        outcome: WorkbenchConversationContribution | Error,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        if (outcome instanceof Error) reject(outcome);
        else resolve(outcome);
      };
      const check = () => {
        if (this.disposed || revealId !== this.revealId) {
          finish(new DOMException('引用定位已取消。', 'AbortError'));
          return;
        }
        const contribution = this.resolveContribution(source);
        if (contribution) finish(contribution);
      };
      const unsubscribe = this.subscribe(check);
      const timer = setTimeout(
        () => finish(new Error('目标资料加载超时，无法定位原文。')),
        timeoutMs,
      );
      check();
    });
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
