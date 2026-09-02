import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import { AgentProviderConnections } from '../agents/AgentProviderConnections';
import { AgentProviderSelector } from '../agents/AgentProviderSelector';
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
import { SelectMenu } from '../components/SelectMenu';

interface LoadedAgentProviderSettingsProps {
  readonly setup: AgentProviderSetupSnapshot;
  readonly api: AgentProviderSetupApi;
  readonly store: AgentProviderStore;
}

function GlobalDefaultStrength({
  setup,
  api,
  store,
}: LoadedAgentProviderSettingsProps) {
  const currentSelectorId =
    setup.defaultSelectorId ?? setup.selectors[0]!.id;
  const [selectorId, setSelectorId] = useState(currentSelectorId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const next = await api.selectDefaultAgentProviderSelector({ selectorId });
      store.getState().applySnapshot(next);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : '无法保存全局默认智能强度。',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5 rounded-[10px] border border-sky-300/15 bg-sky-400/[0.04] p-3">
      <p className="text-sm font-semibold text-slate-200">全局默认智能强度</p>
      <p className="mt-1 text-xs text-slate-500">
        所有新建的 AI 任务都会使用此强度对应的模型；已创建的任务保持原配置。
      </p>
      <div className="mt-3 flex gap-2">
        <SelectMenu
          ariaLabel="全局默认智能强度"
          value={selectorId}
          disabled={saving}
          options={setup.selectors.map((selector) => ({
            value: selector.id,
            label: selector.displayName,
          }))}
          onChange={setSelectorId}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          disabled={saving || selectorId === currentSelectorId}
          onClick={() => void save()}
          className="ui-control h-8 rounded-full border border-white/[0.1] px-3 text-sm text-slate-300 disabled:opacity-40"
        >
          {saving ? '保存中…' : '应用'}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}
    </div>
  );
}

function LoadedAgentProviderSettings({
  setup,
  api,
  store,
}: LoadedAgentProviderSettingsProps) {
  const controller = useAgentProviderSetup({
    setup,
    onCompleted: () => undefined,
    api,
    refreshProvider: (providerId) =>
      store.getState().refreshProvider(providerId),
  });

  return (
    <>
      {setup.selectors.length > 0 && (
        <GlobalDefaultStrength
          key={setup.defaultSelectorId ?? 'no-default-selector'}
          setup={setup}
          api={api}
          store={store}
        />
      )}
      <div className="space-y-3">
        {setup.providers.map((provider) => (
          <AgentProviderConnections
            key={provider.id}
            provider={provider}
            api={api}
            loginChallenge={controller.loginChallenge}
            busyConnectionId={controller.busyConnectionId}
            onStartLogin={(providerId, connectionId) => {
              void controller.startLogin(providerId, connectionId);
            }}
            onRefresh={(providerId) => {
              void controller.refresh(providerId);
            }}
            onReopenLogin={controller.reopenLogin}
            onSetupChange={(next) => store.getState().applySnapshot(next)}
          />
        ))}
      </div>

      {setup.providers.length === 0 && (
        <p className="text-sm text-slate-400">
          当前没有可用的 AI Provider。
        </p>
      )}

      {setup.selectors.length > 0 && (
        <div className="mt-6 border-t border-white/[0.08] pt-5">
          <h4 className="text-sm font-semibold text-slate-200">智能强度</h4>
          <p className="mt-1 text-xs text-slate-500">
            按任务所需强度选择 Connection、模型与思考力度。
          </p>
          <div className="mt-3 space-y-2.5">
            {setup.selectors.map((selector) => (
              <AgentProviderSelector
                key={selector.id}
                selectorId={selector.id}
                api={api}
                store={store}
              />
            ))}
          </div>
        </div>
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
  const loading = useStore(resolvedStore, (state) => state.loading);
  const loadError = useStore(resolvedStore, (state) => state.loadError);

  useEffect(() => resolvedStore.getState().connect(), [resolvedStore]);

  return (
    <section>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-200">AI Provider</h3>
        <p className="mt-1 text-xs text-slate-500">
          管理账号与 API Connection。
        </p>
      </div>

      {loading && !setup && (
        <p className="text-sm text-slate-400">正在读取 Provider 列表…</p>
      )}

      {loadError && (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-3.5 py-3 text-xs text-rose-200"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => void resolvedStore.getState().reload()}
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
