import { randomUUID } from 'node:crypto';

import {
  cloneAgentProviderConnectionConfiguration,
  cloneAgentProviderSelectorSelection,
  type AgentProviderConnectionSnapshot,
  type AgentProviderLoginChallenge,
  type AgentProviderModelCatalogSnapshot,
  type AgentProviderSelectorSelectionSnapshot,
  type AgentProviderSetupSnapshot,
  type AgentProviderSnapshot,
} from '../../shared/agent-providers';
import { AppError } from '../errors/app-error';
import type {
  GenerationAgentExecutionConfiguration,
  GenerationAgentRunner,
  GenerationAgentRunnerResolver,
} from '../generation/generation-agent-runner';
import type { SettingsRepository } from '../settings/settings-repository';
import type { AgentProvider } from './agent-provider';
import { AgentProviderConnectionCatalog } from './agent-provider-connection-catalog';
import {
  AgentProviderConnectionRuntime,
  type AgentProviderConnectionRuntimeDependencies,
} from './agent-provider-connection-runtime';
import type { AgentProviderRegistry } from './agent-provider-registry';
import type { AgentProviderSecretStore } from './agent-provider-secret-file';
import type { AgentProviderSelectorRegistry } from './agent-provider-selector-registry';

export interface ConfigureAgentProviderApiConnectionInput {
  readonly providerId: string;
  readonly connectionId?: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export interface AgentProviderServiceApi {
  getSetup(): Promise<AgentProviderSetupSnapshot>;
  refreshProvider(providerId: string): Promise<AgentProviderSetupSnapshot>;
  subscribe(listener: (snapshot: AgentProviderSetupSnapshot) => void): () => void;
  startLogin(
    providerId: string,
    connectionId: string,
  ): Promise<AgentProviderLoginChallenge>;
  cancelLogin(
    providerId: string,
    connectionId: string,
    loginId: string,
  ): Promise<void>;
  configureApiConnection(
    input: ConfigureAgentProviderApiConnectionInput,
  ): Promise<AgentProviderSetupSnapshot>;
  deleteConnection(
    providerId: string,
    connectionId: string,
  ): Promise<AgentProviderSetupSnapshot>;
  getModelCatalog(
    providerId: string,
    connectionId: string,
  ): Promise<AgentProviderModelCatalogSnapshot>;
  selectForSelector(
    selection: AgentProviderSelectorSelectionSnapshot,
  ): Promise<AgentProviderSetupSnapshot>;
  dispose(): Promise<void>;
}

export interface AgentProviderServiceDependencies
  extends AgentProviderConnectionRuntimeDependencies {
  readonly createId: () => string;
}

interface AgentProviderServiceLocalDependencies {
  readonly logger: Pick<Console, 'warn'>;
  readonly createId: () => string;
}

function requireDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) {
    throw new AppError('INVALID_IPC_REQUEST');
  }
  return normalized;
}

export class AgentProviderService
  implements AgentProviderServiceApi, GenerationAgentRunnerResolver
{
  private readonly dependencies: AgentProviderServiceLocalDependencies;
  private readonly connections: AgentProviderConnectionCatalog;
  private readonly connectionRuntime: AgentProviderConnectionRuntime;
  private readonly listeners = new Set<
    (snapshot: AgentProviderSetupSnapshot) => void
  >();
  private revision = 0;
  private disposed = false;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly secrets: AgentProviderSecretStore,
    private readonly registry: AgentProviderRegistry,
    private readonly selectors: AgentProviderSelectorRegistry,
    dependencies: Partial<AgentProviderServiceDependencies> = {},
  ) {
    this.dependencies = {
      logger: dependencies.logger ?? console,
      createId: dependencies.createId ?? randomUUID,
    };
    this.connections = new AgentProviderConnectionCatalog(settings, registry);
    this.connectionRuntime = new AgentProviderConnectionRuntime(
      secrets,
      registry,
      this.connections,
      () => this.publish(),
      dependencies,
    );
  }

  getSetup(): Promise<AgentProviderSetupSnapshot> {
    this.requireActive();
    const snapshot = this.createSetupSnapshot();
    for (const provider of this.registry.list()) {
      for (const connection of this.connections.list(provider)) {
        void this.connectionRuntime.ensureRefreshed(provider, connection);
      }
    }
    return Promise.resolve(snapshot);
  }

  refreshProvider(providerId: string): Promise<AgentProviderSetupSnapshot> {
    this.requireActive();
    this.connectionRuntime.refreshProvider(this.registry.require(providerId));
    return Promise.resolve(this.createSetupSnapshot());
  }

  subscribe(
    listener: (snapshot: AgentProviderSetupSnapshot) => void,
  ): () => void {
    this.requireActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startLogin(
    providerId: string,
    connectionId: string,
  ): Promise<AgentProviderLoginChallenge> {
    this.requireActive();
    const provider = this.registry.require(providerId);
    return this.connectionRuntime.startLogin(
      provider,
      this.connections.require(provider, connectionId),
    );
  }

  cancelLogin(
    providerId: string,
    connectionId: string,
    loginId: string,
  ): Promise<void> {
    this.requireActive();
    const provider = this.registry.require(providerId);
    return this.connectionRuntime.cancelLogin(
      provider,
      this.connections.require(provider, connectionId),
      loginId,
    );
  }

  async configureApiConnection(
    input: ConfigureAgentProviderApiConnectionInput,
  ): Promise<AgentProviderSetupSnapshot> {
    this.requireActive();
    const provider = this.registry.require(input.providerId);
    if (!provider.supportedConnectionKinds.includes('api-key')) {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }

    const existing = input.connectionId
      ? this.connections.require(provider, input.connectionId)
      : undefined;
    if (
      existing &&
      (existing.kind !== 'api-key' ||
        this.connections.isBuiltIn(provider, existing.id))
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    const connectionId =
      existing?.id ?? `${provider.id}-api-${this.dependencies.createId()}`;
    const connection = cloneAgentProviderConnectionConfiguration({
      id: connectionId,
      providerId: provider.id,
      kind: 'api-key',
      displayName: requireDisplayName(input.displayName),
      baseUrl: provider.normalizeApiConnectionBaseUrl
        ? provider.normalizeApiConnectionBaseUrl(input.baseUrl)
        : input.baseUrl.trim(),
    });
    const previousSecret = await this.secrets.get(provider.id, connectionId);
    const nextSecret = input.apiKey?.trim();
    if (!previousSecret && !nextSecret) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    if (nextSecret) {
      await this.secrets.set(provider.id, connectionId, nextSecret);
    }
    try {
      await this.settings.updateAgentProviderConnection(connection);
    } catch (error) {
      if (nextSecret) {
        await (previousSecret
          ? this.secrets.set(provider.id, connectionId, previousSecret)
          : this.secrets.delete(provider.id, connectionId)
        ).catch(() => undefined);
      }
      throw error;
    }

    await provider.invalidateConnection?.(connectionId);
    this.connectionRuntime.invalidate(provider.id, connectionId);
    await this.connectionRuntime.ensureRefreshed(provider, connection);
    return this.createSetupSnapshot();
  }

  async deleteConnection(
    providerId: string,
    connectionId: string,
  ): Promise<AgentProviderSetupSnapshot> {
    this.requireActive();
    const provider = this.registry.require(providerId);
    const connection = this.connections.require(provider, connectionId);
    if (this.connections.isBuiltIn(provider, connection.id)) {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }

    await this.settings.deleteAgentProviderConnection(connectionId);
    await this.secrets.delete(providerId, connectionId).catch((error) => {
      this.dependencies.logger.warn('清理 Agent Provider 凭证失败', error);
    });
    await provider.invalidateConnection?.(connectionId);
    this.connectionRuntime.remove(providerId, connectionId);
    return this.createSetupSnapshot();
  }

  async getModelCatalog(
    providerId: string,
    connectionId: string,
  ): Promise<AgentProviderModelCatalogSnapshot> {
    this.requireActive();
    const provider = this.registry.require(providerId);
    const connection = this.connections.require(provider, connectionId);
    const catalog = await provider.getModelCatalog(connection);
    if (
      catalog.providerId !== providerId ||
      catalog.connectionId !== connectionId
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    return catalog;
  }

  async selectForSelector(
    selection: AgentProviderSelectorSelectionSnapshot,
  ): Promise<AgentProviderSetupSnapshot> {
    this.requireActive();
    const normalized = cloneAgentProviderSelectorSelection(selection);
    this.selectors.require(normalized.selectorId);
    const provider = this.registry.require(normalized.providerId);
    const connection = this.connections.require(
      provider,
      normalized.connectionId,
    );
    const catalog = await this.getModelCatalog(provider.id, connection.id);
    const requestedModelId = normalized.modelId?.trim() || undefined;
    const selectedModel = requestedModelId
      ? catalog.models.find((model) => model.id === requestedModelId)
      : catalog.models.find((model) => model.isDefault) ?? catalog.models[0];

    if (requestedModelId && !selectedModel && !catalog.allowsCustomModel) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    if (connection.kind === 'api-key' && !requestedModelId) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    const requestedEffort = normalized.reasoningEffort?.trim() || undefined;
    const supportedEfforts = selectedModel?.reasoningEfforts ?? [];
    if (
      requestedEffort &&
      supportedEfforts.length > 0 &&
      !supportedEfforts.some((effort) => effort.id === requestedEffort)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    await this.settings.updateAgentProviderSelectorSelection({
      selectorId: normalized.selectorId,
      providerId: provider.id,
      connectionId: connection.id,
      modelId: requestedModelId ?? selectedModel?.id ?? null,
      reasoningEffort:
        requestedEffort ?? selectedModel?.defaultReasoningEffort ?? null,
    });
    this.publish();
    return this.createSetupSnapshot();
  }

  resolveSelectorConfiguration(
    selectorId: string,
  ): GenerationAgentExecutionConfiguration {
    this.requireActive();
    this.selectors.require(selectorId);
    const current = this.settings.getAgentProviderSelectorConnection(selectorId);
    if (!current) {
      throw new AppError('AGENT_PROVIDER_SELECTION_REQUIRED');
    }
    const selection = this.settings.getAgentProviderSelectorSelection(
      selectorId,
      current.connectionId,
    );
    if (!selection) {
      throw new AppError('AGENT_PROVIDER_SELECTION_REQUIRED');
    }
    return Object.freeze({
      providerId: selection.providerId,
      connectionId: selection.connectionId,
      ...(selection.modelId ? { modelId: selection.modelId } : {}),
      ...(selection.reasoningEffort
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
    });
  }

  async resolveRunner(
    configuration: GenerationAgentExecutionConfiguration,
  ): Promise<GenerationAgentRunner> {
    this.requireActive();
    const provider = this.registry.require(configuration.providerId);
    const connection = this.connections.require(
      provider,
      configuration.connectionId,
    );
    const runner = await provider.createRunner(
      await this.connectionRuntime.resolveReadyConnection(
        provider,
        connection,
      ),
    );
    if (
      runner.providerId !== provider.id ||
      runner.connectionId !== connection.id
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    return runner;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.connectionRuntime.dispose();
    this.listeners.clear();
  }

  private createSetupSnapshot(): AgentProviderSetupSnapshot {
    const providers = this.registry.list().map((provider) =>
      this.createProviderSnapshot(provider),
    );
    const selectors = this.selectors.list();
    const providerMap = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
    const selectorIds = new Set(selectors.map((selector) => selector.id));
    const selections = this.settings
      .listAgentProviderSelectorSelections()
      .filter((selection) => {
        const provider = providerMap.get(selection.providerId);
        return (
          selectorIds.has(selection.selectorId) &&
          provider?.connections.some(
            (connection) => connection.id === selection.connectionId,
          ) === true
        );
      });
    const selectorConnections = selectors.flatMap((selector) => {
      const active = this.settings.getAgentProviderSelectorConnection(
        selector.id,
      );
      if (
        !active ||
        !selections.some(
          (selection) =>
            selection.selectorId === selector.id &&
            selection.providerId === active.providerId &&
            selection.connectionId === active.connectionId,
        )
      ) {
        return [];
      }
      return [
        Object.freeze({
          selectorId: selector.id,
          providerId: active.providerId,
          connectionId: active.connectionId,
        }),
      ];
    });

    return Object.freeze({
      revision: this.revision,
      providers: Object.freeze(providers),
      selectors: Object.freeze(selectors),
      selections: Object.freeze(selections),
      selectorConnections: Object.freeze(selectorConnections),
    });
  }

  private createProviderSnapshot(
    provider: AgentProvider,
  ): AgentProviderSnapshot {
    const connections = this.connections.list(provider).map((connection) => {
      const runtime = this.connectionRuntime.snapshot(
        provider.id,
        connection.id,
      );
      return Object.freeze({
        ...connection,
        ...runtime.inspection,
        hasApiKey: connection.kind === 'api-key' && runtime.hasApiKey,
        refreshing: runtime.refreshing,
        removable: !this.connections.isBuiltIn(provider, connection.id),
        ...(runtime.refreshError
          ? { statusMessage: runtime.refreshError }
          : {}),
      }) satisfies AgentProviderConnectionSnapshot;
    });

    return Object.freeze({
      id: provider.id,
      displayName: provider.displayName,
      description: provider.description,
      supportedConnectionKinds: provider.supportedConnectionKinds,
      connections: Object.freeze(connections),
      ...(provider.apiConnectionDefaults
        ? {
            apiConnectionDefaults: Object.freeze({
              ...provider.apiConnectionDefaults,
            }),
          }
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
