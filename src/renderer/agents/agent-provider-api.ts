import type {
  AgentProviderLoginChallenge,
  AgentProviderSetupSnapshot,
} from '../../shared/agent-providers';
import type { AppSetupSnapshot } from '../../shared/app-setup';

export interface AgentProviderSetupApi {
  getAgentProviderSetup(): Promise<AgentProviderSetupSnapshot>;
  refreshAgentProvider(input: {
    readonly providerId: string;
  }): Promise<AgentProviderSetupSnapshot>;
  onAgentProviderSetupChanged(
    listener: (snapshot: AgentProviderSetupSnapshot) => void,
  ): () => void;
  startAgentProviderLogin(input: {
    readonly providerId: string;
  }): Promise<AgentProviderLoginChallenge>;
  cancelAgentProviderLogin(input: {
    readonly providerId: string;
    readonly loginId: string;
  }): Promise<void>;
  selectAgentProvider(input: {
    readonly providerId: string;
  }): Promise<AgentProviderSetupSnapshot>;
  completeAgentProviderOnboarding(): Promise<AppSetupSnapshot>;
  openExternal(input: { readonly url: string }): Promise<void>;
}

export const defaultAgentProviderSetupApi: AgentProviderSetupApi = {
  getAgentProviderSetup: () =>
    window.learningCompanion.getAgentProviderSetup(),
  refreshAgentProvider: (input) =>
    window.learningCompanion.refreshAgentProvider(input),
  onAgentProviderSetupChanged: (listener) =>
    window.learningCompanion.onAgentProviderSetupChanged(listener),
  startAgentProviderLogin: (input) =>
    window.learningCompanion.startAgentProviderLogin(input),
  cancelAgentProviderLogin: (input) =>
    window.learningCompanion.cancelAgentProviderLogin(input),
  selectAgentProvider: (input) =>
    window.learningCompanion.selectAgentProvider(input),
  completeAgentProviderOnboarding: () =>
    window.learningCompanion.completeAgentProviderOnboarding(),
  openExternal: (input) =>
    window.learningCompanion.openExternal(input),
};
