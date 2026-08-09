import {
  cloneAgentProviderConnectionConfiguration,
  isAgentProviderConnectionId,
  type AgentProviderConnectionConfiguration,
} from '../../shared/agent-providers';
import { AppError } from '../errors/app-error';
import type { SettingsRepository } from '../settings/settings-repository';
import type { AgentProvider } from './agent-provider';
import type { AgentProviderRegistry } from './agent-provider-registry';

export class AgentProviderConnectionCatalog {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly registry: AgentProviderRegistry,
  ) {
    for (const provider of registry.list()) {
      this.validateProvider(provider);
    }
  }

  list(
    provider: AgentProvider,
  ): readonly AgentProviderConnectionConfiguration[] {
    return Object.freeze([
      ...provider.builtInConnections.map(
        cloneAgentProviderConnectionConfiguration,
      ),
      ...this.settings
        .listAgentProviderConnections()
        .filter((connection) => connection.providerId === provider.id)
        .map(cloneAgentProviderConnectionConfiguration),
    ]);
  }

  find(
    providerId: string,
    connectionId: string,
  ): AgentProviderConnectionConfiguration | undefined {
    if (!isAgentProviderConnectionId(connectionId)) {
      return undefined;
    }
    const provider = this.registry.require(providerId);
    return this.list(provider).find(
      (connection) => connection.id === connectionId,
    );
  }

  require(
    provider: AgentProvider,
    connectionId: string,
  ): AgentProviderConnectionConfiguration {
    const connection = this.find(provider.id, connectionId);
    if (!connection) {
      throw new AppError('AGENT_PROVIDER_NOT_FOUND');
    }
    return connection;
  }

  isBuiltIn(provider: AgentProvider, connectionId: string): boolean {
    return provider.builtInConnections.some(
      (connection) => connection.id === connectionId,
    );
  }

  private validateProvider(provider: AgentProvider): void {
    const ids = new Set<string>();
    for (const connection of this.list(provider)) {
      const normalized = cloneAgentProviderConnectionConfiguration(connection);
      if (
        normalized.providerId !== provider.id ||
        !provider.supportedConnectionKinds.includes(normalized.kind) ||
        ids.has(normalized.id)
      ) {
        throw new AppError('INVALID_EXTENSION_DEFINITION');
      }
      ids.add(normalized.id);
    }
  }
}
