import { AppError } from '../errors/app-error';
import type { WorkbenchConversationContextProvider } from './workbench-conversation-context-provider';

const PROVIDER_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

function requireProviderId(value: string): string {
  const normalized = value.trim();
  if (!PROVIDER_ID_PATTERN.test(normalized)) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }
  return normalized;
}

export class WorkbenchConversationContextProviderRegistry {
  private readonly providers = new Map<
    string,
    WorkbenchConversationContextProvider
  >();

  register(provider: WorkbenchConversationContextProvider): void {
    const id = requireProviderId(provider.id);
    if (
      this.providers.has(id) ||
      typeof provider.prepare !== 'function'
    ) {
      throw new AppError('REGISTRATION_CONFLICT');
    }
    this.providers.set(id, provider);
  }

  require(id: string): WorkbenchConversationContextProvider {
    const provider = this.providers.get(requireProviderId(id));
    if (!provider) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }
    return provider;
  }
}
