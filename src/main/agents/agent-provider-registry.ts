import { isAgentProviderId } from '../../shared/agent-providers';
import { AppError } from '../errors/app-error';
import type { AgentProvider } from './agent-provider';

export class AgentProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider): void {
    if (
      !isAgentProviderId(provider.id) ||
      provider.providerId !== provider.id ||
      provider.displayName.trim().length === 0
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    if (this.providers.has(provider.id)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.providers.set(provider.id, provider);
  }

  list(): readonly AgentProvider[] {
    return [...this.providers.values()];
  }

  require(providerId: string): AgentProvider {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new AppError('AGENT_PROVIDER_NOT_FOUND');
    }

    return provider;
  }
}
