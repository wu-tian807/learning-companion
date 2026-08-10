import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  isAgentProviderId,
  isAgentProviderSetupSnapshot,
  type AgentProviderSetupSnapshot,
  type AgentProviderSnapshot,
} from '../../shared/agent-providers';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  defaultAgentProviderSetupApi,
  type AgentProviderSetupApi,
} from './agent-provider-api';

export interface AgentProviderRendererState {
  readonly setup?: AgentProviderSetupSnapshot;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly loadError?: string;
  connect(): () => void;
  reload(): Promise<void>;
  refreshProvider(providerId: string): Promise<AgentProviderSetupSnapshot>;
  applySnapshot(value: unknown): AgentProviderSetupSnapshot;
}

export type AgentProviderStore =
  StoreApi<AgentProviderRendererState>;

export interface AgentProviderStoreInitialState {
  readonly setup?: AgentProviderSetupSnapshot;
  readonly initialized?: boolean;
  readonly loading?: boolean;
  readonly loadError?: string;
}

export type AgentProviderRendererApi = Pick<
  AgentProviderSetupApi,
  | 'getAgentProviderSetup'
  | 'refreshAgentProvider'
  | 'onAgentProviderSetupChanged'
>;

interface ActiveConnection {
  readonly generation: number;
  readonly disposeSubscription: () => void;
  references: number;
}

function cloneProvider(
  provider: AgentProviderSnapshot,
): AgentProviderSnapshot {
  return {
    ...provider,
    supportedConnectionKinds: [...provider.supportedConnectionKinds],
    connections: provider.connections.map((connection) => ({
      ...connection,
      ...(connection.account ? { account: { ...connection.account } } : {}),
    })),
    ...(provider.apiConnectionDefaults
      ? { apiConnectionDefaults: { ...provider.apiConnectionDefaults } }
      : {}),
  };
}

function requireSetupSnapshot(
  value: unknown,
): AgentProviderSetupSnapshot {
  if (!isAgentProviderSetupSnapshot(value)) {
    throw new Error('Agent Provider 设置状态响应无效');
  }

  return {
    ...value,
    providers: value.providers.map(cloneProvider),
    selectors: value.selectors.map((selector) => ({ ...selector })),
    selections: value.selections.map((selection) => ({ ...selection })),
    selectorConnections: value.selectorConnections.map((active) => ({
      ...active,
    })),
  };
}

function requireProviderId(providerId: string): string {
  const normalized = providerId.trim();

  if (!isAgentProviderId(normalized)) {
    throw new Error('Agent Provider ID 无效');
  }

  return normalized;
}

export function createAgentProviderStore(
  api: AgentProviderRendererApi = defaultAgentProviderSetupApi,
  initialState: AgentProviderStoreInitialState = {},
): AgentProviderStore {
  let nextConnectionGeneration = 0;
  let activeConnection: ActiveConnection | undefined;
  const initialSetup = initialState.setup
    ? requireSetupSnapshot(initialState.setup)
    : undefined;

  const applySnapshot = (
    value: unknown,
  ): AgentProviderSetupSnapshot => {
    const incoming = requireSetupSnapshot(value);
    const current = store.getState().setup;

    if (current && incoming.revision <= current.revision) {
      return current;
    }

    store.setState({
      setup: incoming,
      initialized: true,
      loadError: undefined,
    });
    return incoming;
  };

  const load = async (
    connectionGeneration?: number,
  ): Promise<void> => {
    store.setState({
      loading: true,
      loadError: undefined,
    });

    try {
      const incoming = await api.getAgentProviderSetup();

      if (
        connectionGeneration !== undefined &&
        activeConnection?.generation !== connectionGeneration
      ) {
        return;
      }

      applySnapshot(incoming);
      store.setState({
        initialized: true,
        loading: false,
        loadError: undefined,
      });
    } catch (error) {
      if (
        connectionGeneration !== undefined &&
        activeConnection?.generation !== connectionGeneration
      ) {
        return;
      }

      store.setState({
        loading: false,
        loadError:
          userMessageFromError(
            error,
            '无法读取 AI Provider 状态，请重试。',
          ) ?? '无法读取 AI Provider 状态，请重试。',
      });
    }
  };

  const store = createStore<AgentProviderRendererState>(() => ({
    ...(initialSetup ? { setup: initialSetup } : {}),
    initialized:
      initialState.initialized ?? initialSetup !== undefined,
    loading: initialState.loading ?? false,
    ...(initialState.loadError
      ? { loadError: initialState.loadError }
      : {}),

    connect() {
      if (activeConnection) {
        activeConnection.references += 1;
      } else {
        const generation = ++nextConnectionGeneration;
        const disposeSubscription =
          api.onAgentProviderSetupChanged((snapshot) => {
            if (activeConnection?.generation !== generation) {
              return;
            }

            try {
              applySnapshot(snapshot);
            } catch (error) {
              store.setState({
                loadError:
                  userMessageFromError(
                    error,
                    'Agent Provider 状态事件无效，请重试。',
                  ) ??
                  'Agent Provider 状态事件无效，请重试。',
              });
            }
          });
        activeConnection = {
          generation,
          disposeSubscription,
          references: 1,
        };
        void load(generation);
      }

      let disposed = false;

      return () => {
        if (disposed || !activeConnection) {
          return;
        }

        disposed = true;
        activeConnection.references -= 1;

        if (activeConnection.references === 0) {
          activeConnection.disposeSubscription();
          activeConnection = undefined;
          nextConnectionGeneration += 1;
          store.setState({ loading: false });
        }
      };
    },

    reload: () => load(activeConnection?.generation),

    async refreshProvider(providerId) {
      const snapshot = await api.refreshAgentProvider({
        providerId: requireProviderId(providerId),
      });

      return applySnapshot(snapshot);
    },

    applySnapshot,
  }));

  return store;
}

export const agentProviderStore = createAgentProviderStore();

export function useAgentProviderStore<Selected>(
  selector: (state: AgentProviderRendererState) => Selected,
  store: AgentProviderStore = agentProviderStore,
): Selected {
  return useStore(store, selector);
}
