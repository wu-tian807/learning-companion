import type {
  AgentProviderLoginChallenge,
  AgentProviderSetupSnapshot,
  AgentProviderSnapshot,
} from '../../shared/agent-providers';
import type { AgentProviderSetupApi } from './agent-provider-api';
import { AgentProviderCard } from './AgentProviderCard';
import { agentProviderConnectionPanelRegistry } from './connection-panels/agent-provider-connection-panel-registry';

const AccountConnectionPanel =
  agentProviderConnectionPanelRegistry.require('account');
const ApiKeyConnectionPanel =
  agentProviderConnectionPanelRegistry.require('api-key');

interface AgentProviderConnectionsProps {
  readonly provider: AgentProviderSnapshot;
  readonly api: AgentProviderSetupApi;
  readonly loginChallenge?: AgentProviderLoginChallenge;
  readonly busyConnectionId?: string;
  readonly onStartLogin: (providerId: string, connectionId: string) => void;
  readonly onRefresh: (providerId: string) => void;
  readonly onReopenLogin: () => void;
  readonly onSetupChange: (snapshot: AgentProviderSetupSnapshot) => void;
}

export function AgentProviderConnections({
  provider,
  api,
  loginChallenge,
  busyConnectionId,
  onStartLogin,
  onRefresh,
  onReopenLogin,
  onSetupChange,
}: AgentProviderConnectionsProps) {
  return (
    <AgentProviderCard provider={provider}>
      {provider.connections.map((connection) => {
        const Panel =
          connection.kind === 'account'
            ? AccountConnectionPanel
            : ApiKeyConnectionPanel;
        return (
          <Panel
            key={connection.id}
            provider={provider}
            connection={connection}
            api={api}
            loginChallenge={loginChallenge}
            busy={busyConnectionId === connection.id}
            onStartLogin={(connectionId) =>
              onStartLogin(provider.id, connectionId)
            }
            onRefresh={() => onRefresh(provider.id)}
            onReopenLogin={onReopenLogin}
            onSetupChange={onSetupChange}
          />
        );
      })}

      {provider.supportedConnectionKinds.includes('api-key') && (
        <ApiKeyConnectionPanel
          key={`${provider.id}-new-api-connection`}
          provider={provider}
          api={api}
          busy={false}
          onStartLogin={() => undefined}
          onRefresh={() => onRefresh(provider.id)}
          onReopenLogin={onReopenLogin}
          onSetupChange={onSetupChange}
        />
      )}
    </AgentProviderCard>
  );
}
