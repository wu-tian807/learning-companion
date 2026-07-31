import type {
  AgentProviderCredentialSnapshot,
  AgentProviderLoginChallenge,
} from '../../shared/agent-providers';

export interface AgentProviderApi {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly loginLabel: string;

  getCredentialState(
    refreshCredentials?: boolean,
  ): Promise<AgentProviderCredentialSnapshot>;
  subscribeCredentialInvalidation?(
    listener: () => void,
  ): () => void;
  startLogin(): Promise<AgentProviderLoginChallenge>;
  cancelLogin(loginId: string): Promise<void>;
}
