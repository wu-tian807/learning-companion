import type {
  AgentProviderAccountSnapshot,
  AgentProviderApiConnectionDefaultsSnapshot,
  AgentProviderConnectionConfiguration,
  AgentProviderConnectionKind,
  AgentProviderConnectionStatus,
  AgentProviderLoginChallenge,
  AgentProviderModelCatalogSnapshot,
} from '../../shared/agent-providers';
import type { GenerationAgentRunner } from '../generation/generation-agent-runner';

export interface AgentProviderConnectionInspection {
  readonly status: AgentProviderConnectionStatus;
  readonly statusMessage?: string;
  readonly account?: AgentProviderAccountSnapshot;
}

/** Main-process-only connection material. It is never serialized over IPC. */
export interface ResolvedAgentProviderConnection {
  readonly configuration: AgentProviderConnectionConfiguration;
  readonly apiKey?: string;
}

export interface AgentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly supportedConnectionKinds: readonly AgentProviderConnectionKind[];
  readonly builtInConnections: readonly AgentProviderConnectionConfiguration[];
  readonly apiConnectionDefaults?: AgentProviderApiConnectionDefaultsSnapshot;

  inspectAccountConnection(
    connection: AgentProviderConnectionConfiguration,
    refreshCredentials?: boolean,
  ): Promise<AgentProviderConnectionInspection>;
  subscribeConnectionInvalidation?(
    listener: (connectionId: string) => void,
  ): () => void;
  startLogin(
    connection: AgentProviderConnectionConfiguration,
  ): Promise<AgentProviderLoginChallenge>;
  cancelLogin(
    connection: AgentProviderConnectionConfiguration,
    loginId: string,
  ): Promise<void>;
  normalizeApiConnectionBaseUrl?(baseUrl: string): string;
  /** Selector metadata must remain available without resolving credentials. */
  getModelCatalog(
    connection: AgentProviderConnectionConfiguration,
  ): Promise<AgentProviderModelCatalogSnapshot>;
  /** Runtime creation is the boundary that requires a ready Connection. */
  createRunner(
    connection: ResolvedAgentProviderConnection,
  ): GenerationAgentRunner | Promise<GenerationAgentRunner>;
  invalidateConnection?(connectionId: string): Promise<void> | void;
  dispose?(): Promise<void> | void;
}
