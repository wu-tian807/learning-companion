import type {
  AgentProviderCredentialSnapshot,
  AgentProviderLoginChallenge,
  AgentProviderSetupSnapshot,
  AgentProviderSnapshot,
} from '../../shared/agent-providers';
import { AppError } from '../errors/app-error';
import type { SettingsRepository } from '../settings/settings-repository';
import type { AgentProviderApi } from './agent-provider';
import type { AgentProviderRegistry } from './agent-provider-registry';

export interface AgentProviderServiceApi {
  getSetup(
    refreshCredentials?: boolean,
  ): Promise<AgentProviderSetupSnapshot>;
  refreshProvider(
    providerId: string,
  ): Promise<AgentProviderSetupSnapshot>;
  subscribe(
    listener: (snapshot: AgentProviderSetupSnapshot) => void,
  ): () => void;
  startLogin(providerId: string): Promise<AgentProviderLoginChallenge>;
  cancelLogin(providerId: string, loginId: string): Promise<void>;
  selectProvider(
    providerId: string,
  ): Promise<AgentProviderSetupSnapshot>;
  dispose(): Promise<void>;
}

export interface AgentProviderServiceDependencies {
  readonly logger: Pick<Console, 'warn'>;
  readonly loginPollIntervalMs: number;
  readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}

interface ProviderRuntimeState {
  credential: AgentProviderCredentialSnapshot | undefined;
  refreshing: boolean;
  refreshError: string | undefined;
  generation: number;
  refreshTask: Promise<void> | undefined;
}

interface LoginObserver {
  readonly loginId: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_LOGIN_POLL_INTERVAL_MS = 1_200;

function unavailableCredential(): AgentProviderCredentialSnapshot {
  return Object.freeze({
    status: 'unavailable',
    message: '暂时无法检查登录状态，请稍后重试。',
  });
}

function cloneCredential(
  credential: AgentProviderCredentialSnapshot,
): AgentProviderCredentialSnapshot {
  if (credential.status === 'authenticated') {
    return Object.freeze({
      status: 'authenticated',
      account: Object.freeze({ ...credential.account }),
    });
  }

  return Object.freeze({ ...credential });
}

function refreshFailureMessage(): string {
  return '最新状态检查失败，可重新检查。';
}

export class AgentProviderService
  implements AgentProviderServiceApi
{
  private readonly dependencies: AgentProviderServiceDependencies;
  private readonly providerStates = new Map<
    string,
    ProviderRuntimeState
  >();
  private readonly listeners = new Set<
    (snapshot: AgentProviderSetupSnapshot) => void
  >();
  private readonly disposeProviderSubscriptions: Array<() => void> = [];
  private readonly loginObservers = new Map<string, LoginObserver>();
  private revision = 0;
  private disposed = false;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly registry: AgentProviderRegistry,
    dependencies: Partial<AgentProviderServiceDependencies> = {},
  ) {
    this.dependencies = {
      logger: dependencies.logger ?? console,
      loginPollIntervalMs:
        dependencies.loginPollIntervalMs ??
        DEFAULT_LOGIN_POLL_INTERVAL_MS,
      setTimer:
        dependencies.setTimer ??
        ((callback, delayMs) => setTimeout(callback, delayMs)),
      clearTimer:
        dependencies.clearTimer ?? ((timer) => clearTimeout(timer)),
    };

    for (const provider of this.registry.list()) {
      this.providerStates.set(provider.id, this.createProviderState());

      if (provider.subscribeCredentialInvalidation) {
        this.disposeProviderSubscriptions.push(
          provider.subscribeCredentialInvalidation(() => {
            if (!this.disposed) {
              void this.ensureRefresh(provider);
            }
          }),
        );
      }
    }
  }

  getSetup(): Promise<AgentProviderSetupSnapshot> {
    this.requireActive();
    const snapshot = this.createSetupSnapshot();

    for (const provider of this.registry.list()) {
      void this.ensureRefresh(provider);
    }

    return Promise.resolve(snapshot);
  }

  refreshProvider(
    providerId: string,
  ): Promise<AgentProviderSetupSnapshot> {
    this.requireActive();
    const provider = this.registry.require(providerId);
    void this.ensureRefresh(provider);
    return Promise.resolve(this.createSetupSnapshot());
  }

  subscribe(
    listener: (snapshot: AgentProviderSetupSnapshot) => void,
  ): () => void {
    this.requireActive();
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async startLogin(
    providerId: string,
  ): Promise<AgentProviderLoginChallenge> {
    this.requireActive();
    const provider = this.registry.require(providerId);
    await this.stopLoginObserver(provider, true);
    const challenge = await provider.startLogin();

    this.invalidateRefresh(provider.id);
    this.loginObservers.set(provider.id, {
      loginId: challenge.loginId,
      timer: undefined,
    });
    this.scheduleLoginPoll(provider);

    return challenge;
  }

  async cancelLogin(
    providerId: string,
    loginId: string,
  ): Promise<void> {
    this.requireActive();
    const provider = this.registry.require(providerId);
    const observer = this.loginObservers.get(provider.id);

    if (observer?.loginId === loginId) {
      this.removeLoginObserver(provider.id);
    }

    this.invalidateRefresh(provider.id);
    await provider.cancelLogin(loginId);
    void this.ensureRefresh(provider);
  }

  async selectProvider(
    providerId: string,
  ): Promise<AgentProviderSetupSnapshot> {
    this.requireActive();
    const provider = this.registry.require(providerId);
    await this.ensureRefresh(provider);
    const state = this.requireProviderState(provider);

    if (state.credential?.status !== 'authenticated') {
      throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
    }

    await this.settings.updateSelectedAgentProviderId(provider.id);
    this.publish();
    return this.createSetupSnapshot();
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const loginCancellations: Promise<void>[] = [];

    for (const [providerId, observer] of this.loginObservers) {
      if (observer.timer) {
        this.dependencies.clearTimer(observer.timer);
      }

      const provider = this.registry.require(providerId);
      loginCancellations.push(
        provider.cancelLogin(observer.loginId).catch((error: unknown) => {
          this.dependencies.logger.warn(
            `取消 Agent Provider 登录失败：${providerId}`,
            error,
          );
        }),
      );
    }
    this.loginObservers.clear();

    for (const state of this.providerStates.values()) {
      state.generation += 1;
      state.refreshTask = undefined;
      state.refreshing = false;
    }

    for (const dispose of this.disposeProviderSubscriptions.splice(0)) {
      try {
        dispose();
      } catch (error) {
        this.dependencies.logger.warn(
          '释放 Agent Provider 状态订阅失败',
          error,
        );
      }
    }
    this.listeners.clear();
    await Promise.all(loginCancellations);
  }

  private createProviderState(): ProviderRuntimeState {
    return {
      credential: undefined,
      refreshing: false,
      refreshError: undefined,
      generation: 0,
      refreshTask: undefined,
    };
  }

  private requireProviderState(
    provider: AgentProviderApi,
  ): ProviderRuntimeState {
    let state = this.providerStates.get(provider.id);

    if (!state) {
      state = this.createProviderState();
      this.providerStates.set(provider.id, state);
    }

    return state;
  }

  private ensureRefresh(
    provider: AgentProviderApi,
  ): Promise<void> {
    const state = this.requireProviderState(provider);

    if (state.refreshTask) {
      return state.refreshTask;
    }

    state.generation += 1;
    const generation = state.generation;
    state.refreshing = true;
    state.refreshError = undefined;
    const refreshTask = this.checkCredential(
      provider,
      state,
      generation,
    ).finally(() => {
      if (
        state.generation === generation &&
        state.refreshTask === refreshTask
      ) {
        state.refreshTask = undefined;
      }
    });
    state.refreshTask = refreshTask;
    this.publish();

    return refreshTask;
  }

  private async checkCredential(
    provider: AgentProviderApi,
    state: ProviderRuntimeState,
    generation: number,
  ): Promise<void> {
    try {
      const credential = await provider.getCredentialState(true);

      if (!this.canApply(state, generation)) {
        return;
      }

      state.credential = cloneCredential(credential);
      state.refreshing = false;
      state.refreshError = undefined;
      this.publish();
    } catch (error) {
      if (!this.canApply(state, generation)) {
        return;
      }

      this.dependencies.logger.warn(
        `检查 Agent Provider 登录状态失败：${provider.id}`,
        error,
      );
      if (state.credential) {
        state.refreshError = refreshFailureMessage();
      } else {
        state.credential = unavailableCredential();
        state.refreshError = undefined;
      }
      state.refreshing = false;
      this.publish();
    }
  }

  private canApply(
    state: ProviderRuntimeState,
    generation: number,
  ): boolean {
    return !this.disposed && state.generation === generation;
  }

  private invalidateRefresh(providerId: string): void {
    const provider = this.registry.require(providerId);
    const state = this.requireProviderState(provider);
    state.generation += 1;
    state.refreshTask = undefined;
    state.refreshing = false;
    state.refreshError = undefined;
    this.publish();
  }

  private scheduleLoginPoll(provider: AgentProviderApi): void {
    const observer = this.loginObservers.get(provider.id);

    if (!observer || this.disposed) {
      return;
    }

    observer.timer = this.dependencies.setTimer(() => {
      observer.timer = undefined;
      void this.pollLogin(provider, observer.loginId);
    }, this.dependencies.loginPollIntervalMs);
  }

  private async pollLogin(
    provider: AgentProviderApi,
    loginId: string,
  ): Promise<void> {
    const observer = this.loginObservers.get(provider.id);

    if (
      this.disposed ||
      !observer ||
      observer.loginId !== loginId
    ) {
      return;
    }

    await this.ensureRefresh(provider);
    const currentObserver = this.loginObservers.get(provider.id);
    const state = this.requireProviderState(provider);

    if (
      !currentObserver ||
      currentObserver.loginId !== loginId ||
      this.disposed
    ) {
      return;
    }
    if (
      state.credential?.status === 'authenticated' &&
      state.refreshError === undefined
    ) {
      this.removeLoginObserver(provider.id);
      return;
    }

    this.scheduleLoginPoll(provider);
  }

  private async stopLoginObserver(
    provider: AgentProviderApi,
    cancel: boolean,
  ): Promise<void> {
    const observer = this.loginObservers.get(provider.id);

    if (!observer) {
      return;
    }

    this.removeLoginObserver(provider.id);
    if (cancel) {
      await provider.cancelLogin(observer.loginId);
    }
  }

  private removeLoginObserver(providerId: string): void {
    const observer = this.loginObservers.get(providerId);

    if (observer?.timer) {
      this.dependencies.clearTimer(observer.timer);
    }
    this.loginObservers.delete(providerId);
  }

  private createSetupSnapshot(): AgentProviderSetupSnapshot {
    const registeredProviders = this.registry.list();
    const configuredProviderId =
      this.settings.getSelectedAgentProviderId();
    const selectedProviderId =
      configuredProviderId !== null &&
      registeredProviders.some(
        (provider) => provider.id === configuredProviderId,
      )
        ? configuredProviderId
        : null;
    const providers = registeredProviders.map((provider) =>
      this.createProviderSnapshot(provider, selectedProviderId),
    );
    const activeProvider = providers.find(
      (provider) =>
        provider.selected &&
        provider.credential.status === 'authenticated',
    );

    return Object.freeze({
      revision: this.revision,
      selectedProviderId,
      activeProviderId: activeProvider?.id ?? null,
      requiresSelection: activeProvider === undefined,
      providers: Object.freeze(providers),
    });
  }

  private createProviderSnapshot(
    provider: AgentProviderApi,
    selectedProviderId: string | null,
  ): AgentProviderSnapshot {
    const state = this.requireProviderState(provider);
    const credential = state.credential
      ? cloneCredential(state.credential)
      : Object.freeze({ status: 'checking' as const });

    return Object.freeze({
      id: provider.id,
      displayName: provider.displayName,
      description: provider.description,
      loginLabel: provider.loginLabel,
      selected: provider.id === selectedProviderId,
      credential,
      refreshing: state.refreshing,
      ...(state.refreshError
        ? { refreshError: state.refreshError }
        : {}),
    });
  }

  private publish(): void {
    if (this.disposed) {
      return;
    }

    this.revision += 1;
    const snapshot = this.createSetupSnapshot();

    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.dependencies.logger.warn(
          'Agent Provider 状态监听器执行失败',
          error,
        );
      }
    }
  }

  private requireActive(): void {
    if (this.disposed) {
      throw new Error('AgentProviderService 已释放');
    }
  }
}
