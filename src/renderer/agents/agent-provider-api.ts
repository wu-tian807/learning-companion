import type {
  AgentProviderLoginChallenge,
  AgentProviderSetupSnapshot,
} from '../../shared/agent-providers';
import type { AppSetupSnapshot } from '../../shared/app-setup';

export interface AgentProviderSetupApi {
  getAgentProviderSetup(input?: {
    readonly refreshCredentials?: boolean;
  }): Promise<AgentProviderSetupSnapshot>;
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
  getAgentProviderSetup: (input) =>
    window.learningCompanion.getAgentProviderSetup(input),
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
