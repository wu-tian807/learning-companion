import { useState } from 'react';

import { isAgentProviderSetupSnapshot } from '../../../shared/agent-providers';
import { userMessageFromError } from '../../../shared/ipc-error';
import type { AgentProviderConnectionPanelProps } from './agent-provider-connection-panel';
import {
  agentProviderConnectionStatusClass,
  agentProviderConnectionStatusLabel,
} from './agent-provider-connection-status';

export function AgentProviderApiKeyConnectionPanel({
  provider,
  connection,
  api,
  onRefresh,
  onSetupChange,
}: AgentProviderConnectionPanelProps) {
  const defaults = provider.apiConnectionDefaults;
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(
    connection?.displayName ?? defaults?.displayName ?? 'Custom API',
  );
  const [baseUrl, setBaseUrl] = useState(
    connection?.baseUrl ?? defaults?.baseUrl ?? '',
  );
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const beginEditing = () => {
    setDisplayName(
      connection?.displayName ?? defaults?.displayName ?? 'Custom API',
    );
    setBaseUrl(connection?.baseUrl ?? defaults?.baseUrl ?? '');
    setApiKey('');
    setError(undefined);
    setEditing(true);
  };

  if (!editing) {
    if (!connection) {
      return (
        <button
          type="button"
          onClick={beginEditing}
          className="ui-control w-full rounded-xl border border-dashed border-white/[0.1] px-3.5 py-3 text-left text-[10px] text-slate-400 hover:border-indigo-200/20 hover:text-slate-300"
        >
          + 添加 API Connection
        </button>
      );
    }

    return (
      <section className="rounded-xl border border-white/[0.07] bg-black/[0.08] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-xs font-medium text-slate-300">
                {connection.displayName}
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] ${agentProviderConnectionStatusClass(connection)}`}
              >
                {agentProviderConnectionStatusLabel(connection)}
              </span>
            </div>
            <p className="mt-1 truncate text-[10px] text-slate-500">
              {connection.baseUrl}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="ui-control h-8 rounded-full border border-white/[0.1] px-3 text-[10px] text-slate-300"
            >
              检查
            </button>
            <button
              type="button"
              onClick={beginEditing}
              className="ui-control h-8 rounded-full border border-white/[0.1] px-3 text-[10px] text-slate-300"
            >
              编辑
            </button>
          </div>
        </div>
      </section>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const next = await api.configureAgentProviderApiConnection({
        providerId: provider.id,
        ...(connection ? { connectionId: connection.id } : {}),
        displayName: displayName.trim(),
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      if (!isAgentProviderSetupSnapshot(next)) {
        throw new Error('Agent Provider 设置响应无效');
      }
      setApiKey('');
      setEditing(false);
      onSetupChange(next);
    } catch (saveError) {
      setError(
        userMessageFromError(saveError, '无法保存 API Connection。') ??
          '无法保存 API Connection。',
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!connection) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const next = await api.deleteAgentProviderConnection({
        providerId: provider.id,
        connectionId: connection.id,
      });
      if (!isAgentProviderSetupSnapshot(next)) {
        throw new Error('Agent Provider 设置响应无效');
      }
      onSetupChange(next);
    } catch (removeError) {
      setError(
        userMessageFromError(removeError, '无法删除 API Connection。') ??
          '无法删除 API Connection。',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-indigo-200/10 bg-indigo-300/[0.025] p-3.5">
      <div className="grid gap-2.5">
        <label className="grid gap-1 text-[10px] text-slate-500">
          连接名称
          <input
            value={displayName}
            disabled={saving}
            onChange={(event) => setDisplayName(event.target.value)}
            className="ui-control h-9 rounded-lg border border-white/[0.09] bg-black/10 px-3 text-xs text-slate-200 outline-none"
          />
        </label>
        <label className="grid gap-1 text-[10px] text-slate-500">
          Base URL
          <input
            type="url"
            value={baseUrl}
            disabled={saving}
            onChange={(event) => setBaseUrl(event.target.value)}
            className="ui-control h-9 rounded-lg border border-white/[0.09] bg-black/10 px-3 text-xs text-slate-200 outline-none"
          />
        </label>
        <label className="grid gap-1 text-[10px] text-slate-500">
          API Key
          <input
            type="password"
            value={apiKey}
            disabled={saving}
            autoComplete="off"
            placeholder={
              connection?.hasApiKey ? '留空以保留当前 Key' : '输入 API Key'
            }
            onChange={(event) => setApiKey(event.target.value)}
            className="ui-control h-9 rounded-lg border border-white/[0.09] bg-black/10 px-3 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span
            role={error ? 'alert' : undefined}
            className="text-[10px] text-rose-200"
          >
            {error}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void remove()}
              className="ui-control h-8 rounded-full border border-white/[0.1] px-3 text-[10px] text-slate-400 disabled:opacity-40"
            >
              {connection ? '删除' : '取消'}
            </button>
            <button
              type="button"
              disabled={
                saving ||
                !displayName.trim() ||
                !baseUrl.trim() ||
                (!connection?.hasApiKey && !apiKey.trim())
              }
              onClick={() => void save()}
              className="ui-primary-button h-8 rounded-full bg-slate-50 px-3 text-[10px] font-semibold text-slate-900 disabled:opacity-40"
            >
              {saving ? '保存中…' : '保存 Connection'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
