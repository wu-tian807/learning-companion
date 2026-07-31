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
  startLogin(providerId: string): Promise<AgentProviderLoginChallenge>;
  cancelLogin(providerId: string, loginId: string): Promise<void>;
  selectProvider(providerId: string): Promise<AgentProviderSetupSnapshot>;
}

export interface AgentProviderServiceDependencies {
  readonly logger: Pick<Console, 'warn'>;
}

function unavailableCredential(): AgentProviderCredentialSnapshot {
  return {
    status: 'unavailable',
    message: '暂时无法检查登录状态，请稍后重试。',
  };
}

export class AgentProviderService
  implements AgentProviderServiceApi
{
  private readonly dependencies: AgentProviderServiceDependencies;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly registry: AgentProviderRegistry,
    dependencies: Partial<AgentProviderServiceDependencies> = {},
  ) {
    this.dependencies = {
      logger: dependencies.logger ?? console,
    };
  }

  async getSetup(
    refreshCredentials = false,
  ): Promise<AgentProviderSetupSnapshot> {
    const configuredProviderId =
      this.settings.getSelectedAgentProviderId();
    const registeredProviders = this.registry.list();
    const selectedProviderId =
      configuredProviderId !== null &&
      registeredProviders.some(
        (provider) => provider.id === configuredProviderId,
      )
        ? configuredProviderId
        : null;
    const providers = await Promise.all(
      registeredProviders.map((provider) =>
        this.createSnapshot(
          provider,
          selectedProviderId,
          refreshCredentials,
        ),
      ),
    );
    const activeProvider = providers.find(
      (provider) =>
        provider.selected &&
        provider.credential.status === 'authenticated',
    );

    return Object.freeze({
      revision: 0,
      selectedProviderId,
      activeProviderId: activeProvider?.id ?? null,
      requiresSelection: activeProvider === undefined,
      providers: Object.freeze(providers),
    });
  }

  startLogin(
    providerId: string,
  ): Promise<AgentProviderLoginChallenge> {
    return this.registry.require(providerId).startLogin();
  }

  cancelLogin(
    providerId: string,
    loginId: string,
  ): Promise<void> {
    return this.registry.require(providerId).cancelLogin(loginId);
  }

  async selectProvider(
    providerId: string,
  ): Promise<AgentProviderSetupSnapshot> {
    const provider = this.registry.require(providerId);
    const credential = await provider.getCredentialState(true);

    if (credential.status !== 'authenticated') {
      throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
    }

    await this.settings.updateSelectedAgentProviderId(provider.id);
    return this.getSetup(false);
  }

  private async createSnapshot(
    provider: AgentProviderApi,
    selectedProviderId: string | null,
    refreshCredentials: boolean,
  ): Promise<AgentProviderSnapshot> {
    let credential: AgentProviderCredentialSnapshot;

    try {
      credential = await provider.getCredentialState(
        refreshCredentials,
      );
    } catch (error) {
      this.dependencies.logger.warn(
        `检查 Agent Provider 登录状态失败：${provider.id}`,
        error,
      );
      credential = unavailableCredential();
    }

    return Object.freeze({
      id: provider.id,
      displayName: provider.displayName,
      description: provider.description,
      loginLabel: provider.loginLabel,
      selected: provider.id === selectedProviderId,
      credential,
      refreshing: false,
    });
  }
}
