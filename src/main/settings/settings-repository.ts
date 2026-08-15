import type { AppPreferences, HomePreferences } from '../../shared/app-preferences';
import type { AppSetupSnapshot } from '../../shared/app-setup';
import type {
  AgentProviderConnectionConfiguration,
  AgentProviderSelectorSelectionSnapshot,
} from '../../shared/agent-providers';

export interface SettingsRepository {
  initialize(): Promise<void>;
  get(): AppPreferences;
  updateHomePreferences(home: HomePreferences): Promise<AppPreferences>;
  getAppSetup(): AppSetupSnapshot;
  completeExternalLibraryOnboarding(): Promise<AppSetupSnapshot>;
  completeAgentProviderOnboarding(): Promise<AppSetupSnapshot>;
  getDefaultProjectWorkspace(): string;
  updateDefaultProjectWorkspace(directory: string): Promise<void>;
  getExternalLibrariesPath(): string;
  updateExternalLibrariesPath(directory: string): Promise<void>;
  listAgentProviderConnections(): readonly AgentProviderConnectionConfiguration[];
  getAgentProviderConnection(
    connectionId: string,
  ): AgentProviderConnectionConfiguration | undefined;
  updateAgentProviderConnection(
    connection: AgentProviderConnectionConfiguration,
  ): Promise<void>;
  deleteAgentProviderConnection(connectionId: string): Promise<void>;
  getAgentProviderSelectorSelection(
    selectorId: string,
  ): AgentProviderSelectorSelectionSnapshot | undefined;
  updateAgentProviderSelectorSelection(
    selection: AgentProviderSelectorSelectionSnapshot,
  ): Promise<void>;
}
