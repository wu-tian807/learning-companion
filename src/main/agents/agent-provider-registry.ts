import { isAgentProviderId } from '../../shared/agent-providers';
import { AppError } from '../errors/app-error';
import type { AgentProviderApi } from './agent-provider';

export class AgentProviderRegistry {
  private readonly providers = new Map<string, AgentProviderApi>();

  register(provider: AgentProviderApi): void {
    if (
      !isAgentProviderId(provider.id) ||
      provider.displayName.trim().length === 0
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    if (this.providers.has(provider.id)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.providers.set(provider.id, provider);
  }

  list(): readonly AgentProviderApi[] {
    return [...this.providers.values()];
  }

  require(providerId: string): AgentProviderApi {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new AppError('AGENT_PROVIDER_NOT_FOUND');
    }

    return provider;
  }
}
