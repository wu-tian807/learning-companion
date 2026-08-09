import type { AgentProviderConnectionPanelProps } from './agent-provider-connection-panel';
import {
  agentProviderConnectionStatusClass,
  agentProviderConnectionStatusLabel,
} from './agent-provider-connection-status';

export function AgentProviderAccountConnectionPanel({
  provider,
  connection,
  loginChallenge,
  busy,
  onStartLogin,
  onRefresh,
  onReopenLogin,
}: AgentProviderConnectionPanelProps) {
  if (!connection) {
    return null;
  }

  const awaitingLogin =
    loginChallenge?.providerId === provider.id &&
    loginChallenge.connectionId === connection.id;
  const accountDetails = connection.account
    ? [
        connection.account.email,
        connection.account.planType
          ? `${connection.account.planType} 计划`
          : undefined,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' · ')
    : undefined;

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
          <p className="mt-1 text-[10px] text-slate-500">
            {accountDetails ||
              connection.statusMessage ||
              '使用 Provider 账号认证'}
          </p>
        </div>
        {connection.status === 'ready' ? (
          <button
            type="button"
            disabled={connection.refreshing}
            onClick={onRefresh}
            className="ui-control h-8 shrink-0 rounded-full border border-white/[0.1] px-3 text-[10px] text-slate-300 disabled:opacity-40"
          >
            检查状态
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || connection.refreshing || awaitingLogin}
            onClick={() => onStartLogin(connection.id)}
            className="ui-primary-button h-8 shrink-0 rounded-full bg-slate-50 px-3 text-[10px] font-semibold text-slate-900 disabled:opacity-40"
          >
            {awaitingLogin ? '等待登录…' : '登录'}
          </button>
        )}
      </div>

      {awaitingLogin && (
        <div className="mt-3 rounded-lg border border-indigo-200/10 bg-indigo-300/[0.04] px-3 py-2.5 text-[10px] text-indigo-100/80">
          <p>完成浏览器登录后会自动更新。</p>
          {loginChallenge.type === 'device-code' && (
            <p className="mt-1.5 font-mono text-xs tracking-wider">
              {loginChallenge.userCode}
            </p>
          )}
          <button
            type="button"
            onClick={onReopenLogin}
            className="ui-control mt-1.5 text-[10px] text-indigo-200 underline underline-offset-4"
          >
            重新打开登录页面
          </button>
        </div>
      )}
    </section>
  );
}
