import type {
  AgentProviderLoginChallenge,
  AgentProviderModelCatalogSnapshot,
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
    readonly connectionId: string;
  }): Promise<AgentProviderLoginChallenge>;
  cancelAgentProviderLogin(input: {
    readonly providerId: string;
    readonly connectionId: string;
    readonly loginId: string;
  }): Promise<void>;
  configureAgentProviderApiConnection(input: {
    readonly providerId: string;
    readonly connectionId?: string;
    readonly displayName: string;
    readonly baseUrl: string;
    readonly apiKey?: string;
  }): Promise<AgentProviderSetupSnapshot>;
  deleteAgentProviderConnection(input: {
    readonly providerId: string;
    readonly connectionId: string;
  }): Promise<AgentProviderSetupSnapshot>;
  getAgentProviderModels(input: {
    readonly providerId: string;
    readonly connectionId: string;
  }): Promise<AgentProviderModelCatalogSnapshot>;
  selectAgentProviderForSelector(input: {
    readonly selectorId: string;
    readonly providerId: string;
    readonly connectionId: string;
    readonly modelId: string | null;
    readonly reasoningEffort: string | null;
  }): Promise<AgentProviderSetupSnapshot>;
  completeAgentProviderOnboarding(): Promise<AppSetupSnapshot>;
  openExternal(input: { readonly url: string }): Promise<void>;
}

export const defaultAgentProviderSetupApi: AgentProviderSetupApi = {
  getAgentProviderSetup: () => window.learningCompanion.getAgentProviderSetup(),
  refreshAgentProvider: (input) =>
    window.learningCompanion.refreshAgentProvider(input),
  onAgentProviderSetupChanged: (listener) =>
    window.learningCompanion.onAgentProviderSetupChanged(listener),
  startAgentProviderLogin: (input) =>
    window.learningCompanion.startAgentProviderLogin(input),
  cancelAgentProviderLogin: (input) =>
    window.learningCompanion.cancelAgentProviderLogin(input),
  configureAgentProviderApiConnection: (input) =>
    window.learningCompanion.configureAgentProviderApiConnection(input),
  deleteAgentProviderConnection: (input) =>
    window.learningCompanion.deleteAgentProviderConnection(input),
  getAgentProviderModels: (input) =>
    window.learningCompanion.getAgentProviderModels(input),
  selectAgentProviderForSelector: (input) =>
    window.learningCompanion.selectAgentProviderForSelector(input),
  completeAgentProviderOnboarding: () =>
    window.learningCompanion.completeAgentProviderOnboarding(),
  openExternal: (input) => window.learningCompanion.openExternal(input),
};
