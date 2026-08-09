import type { ComponentType } from 'react';

import type {
  AgentProviderConnectionSnapshot,
  AgentProviderLoginChallenge,
  AgentProviderSnapshot,
  AgentProviderSetupSnapshot,
} from '../../../shared/agent-providers';
import type { AgentProviderSetupApi } from '../agent-provider-api';

export interface AgentProviderConnectionPanelProps {
  readonly provider: AgentProviderSnapshot;
  readonly connection?: AgentProviderConnectionSnapshot;
  readonly api: AgentProviderSetupApi;
  readonly loginChallenge?: AgentProviderLoginChallenge;
  readonly busy: boolean;
  readonly onStartLogin: (connectionId: string) => void;
  readonly onRefresh: () => void;
  readonly onReopenLogin: () => void;
  readonly onSetupChange: (snapshot: AgentProviderSetupSnapshot) => void;
}

export type AgentProviderConnectionPanel =
  ComponentType<AgentProviderConnectionPanelProps>;
