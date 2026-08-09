import type {
  AgentProviderConnectionConfiguration,
  AgentProviderLoginChallenge,
} from '../../shared/agent-providers';
import { AppError } from '../errors/app-error';
import type {
  AgentProvider,
  AgentProviderConnectionInspection,
  ResolvedAgentProviderConnection,
} from './agent-provider';
import type { AgentProviderConnectionCatalog } from './agent-provider-connection-catalog';
import type { AgentProviderRegistry } from './agent-provider-registry';
import type { AgentProviderSecretStore } from './agent-provider-secret-file';

export interface AgentProviderConnectionRuntimeDependencies {
  readonly logger: Pick<Console, 'warn'>;
  readonly loginPollIntervalMs: number;
  readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  readonly probeUrl: (url: string) => Promise<void>;
}

export interface AgentProviderConnectionRuntimeSnapshot {
  readonly inspection: AgentProviderConnectionInspection;
  readonly hasApiKey: boolean;
  readonly refreshing: boolean;
  readonly refreshError?: string;
}

interface ConnectionRuntimeState {
  inspection: AgentProviderConnectionInspection | undefined;
  hasApiKey: boolean;
  refreshing: boolean;
  refreshError: string | undefined;
  generation: number;
  refreshTask: Promise<void> | undefined;
}

interface LoginObserver {
  readonly providerId: string;
  readonly connectionId: string;
  readonly loginId: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_LOGIN_POLL_INTERVAL_MS = 1_200;
const CONNECTION_PROBE_TIMEOUT_MS = 5_000;

async function defaultProbeUrl(url: string): Promise<void> {
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    signal: AbortSignal.timeout(CONNECTION_PROBE_TIMEOUT_MS),
  });
  await response.body?.cancel().catch(() => undefined);
}

function stateKey(providerId: string, connectionId: string): string {
  return `${providerId}/${connectionId}`;
}

function unavailableInspection(
  message: string,
): AgentProviderConnectionInspection {
  return Object.freeze({ status: 'unavailable', statusMessage: message });
}

function cloneInspection(
  inspection: AgentProviderConnectionInspection,
): AgentProviderConnectionInspection {
  return Object.freeze({
    ...inspection,
    ...(inspection.account
      ? { account: Object.freeze({ ...inspection.account }) }
      : {}),
  });
}

export class AgentProviderConnectionRuntime {
  private readonly dependencies: AgentProviderConnectionRuntimeDependencies;
  private readonly states = new Map<string, ConnectionRuntimeState>();
  private readonly loginObservers = new Map<string, LoginObserver>();
  private readonly disposeProviderSubscriptions: Array<() => void> = [];
  private disposed = false;

  constructor(
    private readonly secrets: AgentProviderSecretStore,
    private readonly providers: AgentProviderRegistry,
    private readonly connections: AgentProviderConnectionCatalog,
    private readonly onChanged: () => void,
    dependencies: Partial<AgentProviderConnectionRuntimeDependencies> = {},
  ) {
    this.dependencies = {
      logger: dependencies.logger ?? console,
      loginPollIntervalMs:
        dependencies.loginPollIntervalMs ?? DEFAULT_LOGIN_POLL_INTERVAL_MS,
      setTimer:
        dependencies.setTimer ??
        ((callback, delayMs) => setTimeout(callback, delayMs)),
      clearTimer: dependencies.clearTimer ?? ((timer) => clearTimeout(timer)),
      probeUrl: dependencies.probeUrl ?? defaultProbeUrl,
    };

    for (const provider of providers.list()) {
      if (provider.subscribeConnectionInvalidation) {
        this.disposeProviderSubscriptions.push(
          provider.subscribeConnectionInvalidation((connectionId) => {
            if (this.disposed) {
              return;
            }
            this.invalidate(provider.id, connectionId);
            const connection = this.connections.find(
              provider.id,
              connectionId,
            );
            if (connection) {
              void this.ensureRefreshed(provider, connection);
            }
          }),
        );
      }
    }
  }

  snapshot(
    providerId: string,
    connectionId: string,
  ): AgentProviderConnectionRuntimeSnapshot {
    const state = this.requireState(providerId, connectionId);
    return Object.freeze({
      inspection: cloneInspection(
        state.inspection ?? Object.freeze({ status: 'unconfigured' }),
      ),
      hasApiKey: state.hasApiKey,
      refreshing: state.refreshing,
      ...(state.refreshError ? { refreshError: state.refreshError } : {}),
    });
  }

  refreshProvider(provider: AgentProvider): void {
    this.requireActive();
    for (const connection of this.connections.list(provider)) {
      this.invalidate(provider.id, connection.id);
      void this.ensureRefreshed(provider, connection);
    }
  }

  ensureRefreshed(
    provider: AgentProvider,
    connection: AgentProviderConnectionConfiguration,
  ): Promise<void> {
    this.requireActive();
    const state = this.requireState(provider.id, connection.id);
    if (state.refreshTask) {
      return state.refreshTask;
    }

    state.generation += 1;
    const generation = state.generation;
    state.refreshing = true;
    state.refreshError = undefined;
    const refreshTask = this.inspect(provider, connection)
      .then(({ inspection, hasApiKey }) => {
        if (!this.disposed && state.generation === generation) {
          state.inspection = cloneInspection(inspection);
          state.hasApiKey = hasApiKey;
          state.refreshing = false;
          state.refreshError = undefined;
          this.onChanged();
        }
      })
      .catch((error: unknown) => {
        if (!this.disposed && state.generation === generation) {
          this.dependencies.logger.warn(
            `检查 Agent Provider Connection 失败：${provider.id}/${connection.id}`,
            error,
          );
          state.inspection = unavailableInspection('连接状态暂时不可用。');
          state.refreshing = false;
          state.refreshError = '最新状态检查失败，可重新检查。';
          this.onChanged();
        }
      })
      .finally(() => {
        if (
          state.generation === generation &&
          state.refreshTask === refreshTask
        ) {
          state.refreshTask = undefined;
        }
      });
    state.refreshTask = refreshTask;
    this.onChanged();
    return refreshTask;
  }

  async resolveReadyConnection(
    provider: AgentProvider,
    connection: AgentProviderConnectionConfiguration,
  ): Promise<ResolvedAgentProviderConnection> {
    await this.ensureRefreshed(provider, connection);
    const state = this.requireState(provider.id, connection.id);
    if (state.inspection?.status !== 'ready') {
      throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
    }

    if (connection.kind === 'account') {
      return Object.freeze({ configuration: connection });
    }
    const apiKey = await this.secrets.get(provider.id, connection.id);
    if (!apiKey) {
      throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
    }
    return Object.freeze({ configuration: connection, apiKey });
  }

  async startLogin(
    provider: AgentProvider,
    connection: AgentProviderConnectionConfiguration,
  ): Promise<AgentProviderLoginChallenge> {
    this.requireActive();
    if (connection.kind !== 'account') {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }

    const key = stateKey(provider.id, connection.id);
    await this.stopLoginObserver(key, true);
    const challenge = await provider.startLogin(connection);
    if (
      challenge.providerId !== provider.id ||
      challenge.connectionId !== connection.id
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    this.invalidate(provider.id, connection.id);
    this.loginObservers.set(key, {
      providerId: provider.id,
      connectionId: connection.id,
      loginId: challenge.loginId,
      timer: undefined,
    });
    this.scheduleLoginPoll(key);
    return challenge;
  }

  async cancelLogin(
    provider: AgentProvider,
    connection: AgentProviderConnectionConfiguration,
    loginId: string,
  ): Promise<void> {
    this.requireActive();
    const key = stateKey(provider.id, connection.id);
    const observer = this.loginObservers.get(key);
    if (observer?.loginId === loginId) {
      this.removeLoginObserver(key);
    }

    this.invalidate(provider.id, connection.id);
    await provider.cancelLogin(connection, loginId);
    void this.ensureRefreshed(provider, connection);
  }

  invalidate(providerId: string, connectionId: string): void {
    this.requireActive();
    const state = this.requireState(providerId, connectionId);
    state.generation += 1;
    state.refreshTask = undefined;
    state.refreshing = false;
    state.refreshError = undefined;
    this.onChanged();
  }

  remove(providerId: string, connectionId: string): void {
    this.requireActive();
    this.removeLoginObserver(stateKey(providerId, connectionId));
    this.states.delete(stateKey(providerId, connectionId));
    this.onChanged();
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    const cancellations = [...this.loginObservers.values()].map(
      async (observer) => {
        const provider = this.providers.require(observer.providerId);
        const connection = this.connections.find(
          observer.providerId,
          observer.connectionId,
        );
        if (connection) {
          await provider
            .cancelLogin(connection, observer.loginId)
            .catch((error) => {
              this.dependencies.logger.warn(
                '取消 Agent Provider 登录失败',
                error,
              );
            });
        }
      },
    );
    for (const observer of this.loginObservers.values()) {
      if (observer.timer) {
        this.dependencies.clearTimer(observer.timer);
      }
    }
    this.loginObservers.clear();
    for (const dispose of this.disposeProviderSubscriptions.splice(0)) {
      dispose();
    }
    await Promise.all(cancellations);
    for (const provider of this.providers.list()) {
      await provider.dispose?.();
    }
    this.states.clear();
  }

  private async inspect(
    provider: AgentProvider,
    connection: AgentProviderConnectionConfiguration,
  ): Promise<{
    readonly inspection: AgentProviderConnectionInspection;
    readonly hasApiKey: boolean;
  }> {
    if (connection.kind === 'account') {
      return {
        inspection: await provider.inspectAccountConnection(connection, true),
        hasApiKey: false,
      };
    }

    const apiKey = await this.secrets.get(provider.id, connection.id);
    if (!apiKey) {
      return {
        inspection: Object.freeze({ status: 'unconfigured' }),
        hasApiKey: false,
      };
    }
    try {
      await this.dependencies.probeUrl(connection.baseUrl);
      return {
        inspection: Object.freeze({ status: 'ready' }),
        hasApiKey: true,
      };
    } catch {
      return {
        inspection: unavailableInspection('无法连接 Base URL。'),
        hasApiKey: true,
      };
    }
  }

  private requireState(
    providerId: string,
    connectionId: string,
  ): ConnectionRuntimeState {
    const key = stateKey(providerId, connectionId);
    let state = this.states.get(key);
    if (!state) {
      state = {
        inspection: undefined,
        hasApiKey: false,
        refreshing: false,
        refreshError: undefined,
        generation: 0,
        refreshTask: undefined,
      };
      this.states.set(key, state);
    }
    return state;
  }

  private scheduleLoginPoll(key: string): void {
    const observer = this.loginObservers.get(key);
    if (!observer || this.disposed) {
      return;
    }
    observer.timer = this.dependencies.setTimer(() => {
      observer.timer = undefined;
      void this.pollLogin(key, observer.loginId);
    }, this.dependencies.loginPollIntervalMs);
  }

  private async pollLogin(key: string, loginId: string): Promise<void> {
    const observer = this.loginObservers.get(key);
    if (!observer || observer.loginId !== loginId || this.disposed) {
      return;
    }
    const provider = this.providers.require(observer.providerId);
    const connection = this.connections.require(
      provider,
      observer.connectionId,
    );
    await this.ensureRefreshed(provider, connection);
    const current = this.loginObservers.get(key);
    const state = this.requireState(provider.id, connection.id);
    if (!current || current.loginId !== loginId || this.disposed) {
      return;
    }
    if (state.inspection?.status === 'ready' && !state.refreshError) {
      this.removeLoginObserver(key);
      return;
    }
    this.scheduleLoginPoll(key);
  }

  private async stopLoginObserver(
    key: string,
    cancel: boolean,
  ): Promise<void> {
    const observer = this.loginObservers.get(key);
    if (!observer) {
      return;
    }
    this.removeLoginObserver(key);
    if (cancel) {
      const provider = this.providers.require(observer.providerId);
      const connection = this.connections.require(
        provider,
        observer.connectionId,
      );
      await provider.cancelLogin(connection, observer.loginId);
    }
  }

  private removeLoginObserver(key: string): void {
    const observer = this.loginObservers.get(key);
    if (observer?.timer) {
      this.dependencies.clearTimer(observer.timer);
    }
    this.loginObservers.delete(key);
  }

  private requireActive(): void {
    if (this.disposed) {
      throw new Error('AgentProviderConnectionRuntime 已释放');
    }
  }
}
