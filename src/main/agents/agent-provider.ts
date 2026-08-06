import type {
  AgentProviderCredentialSnapshot,
  AgentProviderLoginChallenge,
} from '../../shared/agent-providers';
import type { GenerationAgentRunner } from '../generation/generation-agent-runner';

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

export interface AgentProvider
  extends AgentProviderApi,
    GenerationAgentRunner {}
