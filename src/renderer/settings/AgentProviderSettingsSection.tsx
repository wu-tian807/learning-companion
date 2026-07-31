import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';

import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import { AgentProviderCard } from '../agents/AgentProviderCard';
import {
  defaultAgentProviderSetupApi,
  type AgentProviderSetupApi,
} from '../agents/agent-provider-api';
import {
  agentProviderStore,
  createAgentProviderStore,
  type AgentProviderStore,
} from '../agents/agent-provider-store';
import { useAgentProviderSetup } from '../agents/use-agent-provider-setup';
import { ErrorDialog } from '../components/ErrorDialog';

interface LoadedAgentProviderSettingsProps {
  readonly setup: AgentProviderSetupSnapshot;
  readonly api: AgentProviderSetupApi;
  readonly store: AgentProviderStore;
}

function LoadedAgentProviderSettings({
  setup,
  api,
  store,
}: LoadedAgentProviderSettingsProps) {
  const controller = useAgentProviderSetup({
    setup,
    onSetupChange: (next) => {
      store.getState().applySnapshot(next);
    },
    onCompleted: () => undefined,
    api,
    refreshProvider: (providerId) =>
      store.getState().refreshProvider(providerId),
  });

  return (
    <>
      <div className="space-y-3">
        {setup.providers.map((provider) => (
          <AgentProviderCard
            key={provider.id}
            provider={provider}
            loginChallenge={controller.loginChallenge}
            busy={controller.busyProviderId === provider.id}
            onLogin={() => {
              void controller.startLogin(provider.id);
            }}
            onSelect={() => {
              void controller.selectProvider(provider.id);
            }}
            onRefresh={() => {
              void controller.refresh(provider.id);
            }}
            onReopenLogin={controller.reopenLogin}
          />
        ))}
      </div>

      {setup.providers.length === 0 && (
        <p className="text-sm text-slate-400">
          当前没有可用的 AI Provider。
        </p>
      )}

      {controller.error && (
        <ErrorDialog
          message={controller.error}
          onClose={controller.clearError}
        />
      )}
    </>
  );
}

interface AgentProviderSettingsSectionProps {
  readonly api?: AgentProviderSetupApi;
  readonly store?: AgentProviderStore;
}

export function AgentProviderSettingsSection({
  api = defaultAgentProviderSetupApi,
  store,
}: AgentProviderSettingsSectionProps) {
  const resolvedStore = useMemo(
    () =>
      store ??
      (api === defaultAgentProviderSetupApi
        ? agentProviderStore
        : createAgentProviderStore(api)),
    [api, store],
  );
  const setup = useStore(resolvedStore, (state) => state.setup);
  const loading = useStore(
    resolvedStore,
    (state) => state.loading,
  );
  const loadError = useStore(
    resolvedStore,
    (state) => state.loadError,
  );

  useEffect(() => {
    return resolvedStore.getState().connect();
  }, [resolvedStore]);

  return (
    <section>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-200">
          AI Provider
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          选择用于 AI 功能的账号。
        </p>
      </div>

      {loading && !setup && (
        <p className="text-sm text-slate-400">
          正在读取 Provider 列表…
        </p>
      )}

      {loadError && (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-3.5 py-3 text-xs text-rose-200"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              void resolvedStore.getState().reload();
            }}
            className="ui-control h-8 shrink-0 rounded-full border border-rose-200/15 px-3"
          >
            重试
          </button>
        </div>
      )}

      {setup && (
        <LoadedAgentProviderSettings
          setup={setup}
          api={api}
          store={resolvedStore}
        />
      )}
    </section>
  );
}
