import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import {
  isAgentProviderModelCatalogSnapshot,
  isAgentProviderSetupSnapshot,
  type AgentProviderConnectionSnapshot,
  type AgentProviderModelCatalogSnapshot,
  type AgentProviderSelectorDefinitionSnapshot,
  type AgentProviderSelectorSelectionSnapshot,
  type AgentProviderSetupSnapshot,
  type AgentProviderSnapshot,
} from '../../shared/agent-providers';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  defaultAgentProviderSetupApi,
  type AgentProviderSetupApi,
} from './agent-provider-api';
import {
  agentProviderStore,
  type AgentProviderStore,
} from './agent-provider-store';
import { SelectMenu } from '../components/SelectMenu';

const CUSTOM_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;
const DEFAULT_REASONING_EFFORT = 'high';

interface SelectorConnection {
  readonly provider: AgentProviderSnapshot;
  readonly connection: AgentProviderConnectionSnapshot;
}

interface AgentProviderSelectorProps {
  readonly selectorId: string;
  readonly api?: AgentProviderSetupApi;
  readonly store?: AgentProviderStore;
}

interface AgentProviderSelectorFormProps {
  readonly definition: AgentProviderSelectorDefinitionSnapshot;
  readonly api: AgentProviderSetupApi;
  readonly store: AgentProviderStore;
  readonly connections: readonly SelectorConnection[];
  readonly selection?: AgentProviderSelectorSelectionSnapshot;
}

function connectionValue(providerId: string, connectionId: string): string {
  return `${providerId}:${connectionId}`;
}

function defaultReasoningEffort(
  model: AgentProviderModelCatalogSnapshot['models'][number] | undefined,
): string {
  const supported = model?.reasoningEfforts.map((effort) => effort.id) ?? [];
  if (supported.length === 0 || supported.includes(DEFAULT_REASONING_EFFORT)) {
    return DEFAULT_REASONING_EFFORT;
  }
  if (
    model?.defaultReasoningEffort &&
    supported.includes(model.defaultReasoningEffort)
  ) {
    return model.defaultReasoningEffort;
  }
  return supported[0] ?? DEFAULT_REASONING_EFFORT;
}

/**
 * 查找某个 (selector, connection) 已保存的模型配置。
 * 每个 Connection 各存一份，切换 Connection 时用各自的配置恢复。
 */
export function findSelectorConnectionSelection(
  setup: AgentProviderSetupSnapshot | undefined,
  selectorId: string,
  connectionId: string,
): AgentProviderSelectorSelectionSnapshot | undefined {
  return setup?.selections.find(
    (selection) =>
      selection.selectorId === selectorId &&
      selection.connectionId === connectionId,
  );
}

function AgentProviderSelectorForm({
  definition,
  api,
  store,
  connections,
  selection,
}: AgentProviderSelectorFormProps) {
  const selectedConfiguredConnection = connections.find(
    ({ provider, connection }) =>
      provider.id === selection?.providerId &&
      connection.id === selection.connectionId,
  );
  const initial = selectedConfiguredConnection ?? connections[0];
  const reusesSavedSelection = selectedConfiguredConnection !== undefined;
  const [selectedConnection, setSelectedConnection] = useState(
    initial ? connectionValue(initial.provider.id, initial.connection.id) : '',
  );
  const [modelId, setModelId] = useState(
    reusesSavedSelection ? selection?.modelId ?? '' : '',
  );
  const [reasoningEffort, setReasoningEffort] = useState(
    reusesSavedSelection
      ? selection?.reasoningEffort ?? ''
      : DEFAULT_REASONING_EFFORT,
  );
  const [catalog, setCatalog] = useState<AgentProviderModelCatalogSnapshot>();
  const [loadingCatalog, setLoadingCatalog] = useState(Boolean(initial));
  // 连接重选（含选回同一连接）时递增，强制模型目录 effect 重跑
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const resolvedConnection = connections.find(
    ({ provider, connection }) =>
      connectionValue(provider.id, connection.id) === selectedConnection,
  );
  const resolvedProviderId = resolvedConnection?.provider.id;
  const resolvedConnectionId = resolvedConnection?.connection.id;

  useEffect(() => {
    if (!resolvedProviderId || !resolvedConnectionId) {
      return;
    }

    let active = true;
    void api
      .getAgentProviderModels({
        providerId: resolvedProviderId,
        connectionId: resolvedConnectionId,
      })
      .then((next) => {
        if (!active) {
          return;
        }
        if (!isAgentProviderModelCatalogSnapshot(next)) {
          throw new Error('Provider 模型目录响应无效');
        }
        setCatalog(next);
        const defaultModel =
          next.models.find((model) => model.isDefault) ?? next.models[0];
        setModelId((current) => current || defaultModel?.id || '');
        setReasoningEffort((current) => {
          const supported =
            defaultModel?.reasoningEfforts.map((effort) => effort.id) ?? [];
          if (
            current &&
            (supported.length === 0 || supported.includes(current))
          ) {
            return current;
          }
          return defaultReasoningEffort(defaultModel);
        });
      })
      .catch((catalogError) => {
        if (active) {
          setCatalog(undefined);
          setError(
            userMessageFromError(
              catalogError,
              '无法读取模型列表；API Connection 可直接填写模型 ID。',
            ) ?? '无法读取模型列表。',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoadingCatalog(false);
        }
      });

    return () => {
      active = false;
    };
  }, [api, resolvedConnectionId, resolvedProviderId, catalogEpoch]);

  const selectedModel = catalog?.models.find((model) => model.id === modelId);
  const effortOptions =
    selectedModel && selectedModel.reasoningEfforts.length > 0
      ? selectedModel.reasoningEfforts.map((effort) => effort.id)
      : CUSTOM_REASONING_EFFORTS;

  /** 恢复某个 Connection 已保存的模型/思考力度配置（没有则回落默认）。 */
  const restoreConnectionSelection = (
    connection: SelectorConnection | undefined,
  ) => {
    if (!connection) {
      return;
    }
    const saved = findSelectorConnectionSelection(
      store.getState().setup,
      definition.id,
      connection.connection.id,
    );
    if (saved?.modelId) {
      setModelId(saved.modelId);
      setReasoningEffort(saved.reasoningEffort ?? '');
    } else {
      setModelId('');
      setReasoningEffort(DEFAULT_REASONING_EFFORT);
    }
  };

  const save = async () => {
    if (!resolvedConnection || !modelId.trim()) {
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const next = await api.selectAgentProviderForSelector({
        selectorId: definition.id,
        providerId: resolvedConnection.provider.id,
        connectionId: resolvedConnection.connection.id,
        modelId: modelId.trim(),
        reasoningEffort: reasoningEffort.trim() || null,
      });
      if (!isAgentProviderSetupSnapshot(next)) {
        throw new Error('Provider 选择响应无效');
      }
      store.getState().applySnapshot(next);
    } catch (saveError) {
      setError(
        userMessageFromError(saveError, '无法保存 AI 执行配置。') ??
          '无法保存 AI 执行配置。',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-[10px] border border-white/[0.065] bg-white/[0.018] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold text-slate-300">
            {definition.displayName}
          </p>
          <p className="mt-1 text-[9px] leading-4 text-slate-600">
            {definition.description}
          </p>
        </div>
        {selection && (
          <span className="shrink-0 text-[9px] text-emerald-200/70">
            已配置
          </span>
        )}
      </div>

      {connections.length === 0 ? (
        <p className="mt-2 text-[9px] leading-4 text-slate-500">
          当前 Provider 没有可配置的 Connection。
        </p>
      ) : (
        <div className="mt-2 grid gap-2">
          <SelectMenu
            ariaLabel={`${definition.displayName} Connection`}
            value={selectedConnection}
            disabled={saving}
            options={connections.map(({ provider, connection }) => ({
              value: connectionValue(provider.id, connection.id),
              label: `${provider.displayName} · ${connection.displayName}`,
            }))}
            onChange={(value) => {
              const nextConnection = connections.find(
                ({ provider, connection }) =>
                  connectionValue(provider.id, connection.id) === value,
              );
              setSelectedConnection(value);
              // 恢复该 Connection 上次保存的模型/思考力度；没有则回落默认。
              restoreConnectionSelection(nextConnection);
              setCatalog(undefined);
              setLoadingCatalog(true);
              setError(undefined);
              // 连接 ID 不变（重选同一连接）时 effect 不会重跑，用 epoch 强制刷新目录
              setCatalogEpoch((epoch) => epoch + 1);
            }}
            className="w-full"
          />

          {catalog?.allowsCustomModel ? (
            <SelectMenu
              ariaLabel={`${definition.displayName} 模型`}
              value={modelId}
              disabled={saving || loadingCatalog}
              placeholder="输入模型 ID"
              editable
              options={catalog.models.map((model) => ({
                value: model.id,
                label: model.displayName,
              }))}
              onChange={(nextModelId) => {
                setModelId(nextModelId);
                const nextModel = catalog.models.find(
                  (model) => model.id === nextModelId,
                );
                if (nextModel) {
                  setReasoningEffort(defaultReasoningEffort(nextModel));
                }
              }}
              className="w-full"
            />
          ) : (
            <SelectMenu
              ariaLabel={`${definition.displayName} 模型`}
              value={modelId}
              disabled={saving || loadingCatalog}
              placeholder={loadingCatalog ? '正在读取模型…' : '请选择模型'}
              options={
                catalog?.models.map((model) => ({
                  value: model.id,
                  label: model.displayName,
                })) ?? []
              }
              onChange={(nextModelId) => {
                const nextModel = catalog?.models.find(
                  (model) => model.id === nextModelId,
                );
                setModelId(nextModelId);
                setReasoningEffort(defaultReasoningEffort(nextModel));
              }}
              className="w-full"
            />
          )}

          <div className="flex gap-2">
            <SelectMenu
              ariaLabel={`${definition.displayName} 思考力度`}
              value={reasoningEffort}
              disabled={saving || loadingCatalog}
              options={[
                { value: '', label: 'Provider 默认力度' },
                ...effortOptions.map((effort) => ({
                  value: effort,
                  label: effort,
                })),
              ]}
              onChange={setReasoningEffort}
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              disabled={saving || loadingCatalog || !modelId.trim()}
              onClick={() => void save()}
              className="ui-control h-8 rounded-full border border-white/[0.1] px-3 text-sm text-slate-300 disabled:opacity-40"
            >
              {saving ? '保存中…' : '应用'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[9px] leading-4 text-rose-200">
          {error}
        </p>
      )}
    </section>
  );
}

export function AgentProviderSelector({
  selectorId,
  api = defaultAgentProviderSetupApi,
  store = agentProviderStore,
}: AgentProviderSelectorProps) {
  const setup = useStore(store, (state) => state.setup);
  const definition = setup?.selectors.find(
    (candidate) => candidate.id === selectorId,
  );
  const selection = setup?.selections.find(
    (candidate) => candidate.selectorId === selectorId,
  );
  const connections = useMemo(
    () =>
      setup?.providers.flatMap((provider) =>
        provider.connections.map((connection) => ({ provider, connection })),
      ) ?? [],
    [setup],
  );

  useEffect(() => store.getState().connect(), [store]);

  if (!definition) {
    return null;
  }

  const formIdentity = [
    selectorId,
    selection?.providerId ?? '',
    selection?.connectionId ?? '',
    selection?.modelId ?? '',
    selection?.reasoningEffort ?? '',
    connections
      .map(({ provider, connection }) => `${provider.id}/${connection.id}`)
      .join(','),
  ].join(':');

  return (
    <AgentProviderSelectorForm
      key={formIdentity}
      definition={definition}
      api={api}
      store={store}
      connections={connections}
      selection={selection}
    />
  );
}
