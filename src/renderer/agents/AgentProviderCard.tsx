import type {
  AgentProviderLoginChallenge,
  AgentProviderSnapshot,
} from '../../shared/agent-providers';

interface AgentProviderCardProps {
  readonly provider: AgentProviderSnapshot;
  readonly loginChallenge?: AgentProviderLoginChallenge;
  readonly busy: boolean;
  readonly checking: boolean;
  readonly selectedActionLabel?: string;
  readonly onLogin: () => void;
  readonly onSelect: () => void;
  readonly onRefresh: () => void;
  readonly onReopenLogin: () => void;
}

function credentialLabel(provider: AgentProviderSnapshot): string {
  if (provider.credential.status === 'authenticated') {
    return '已登录';
  }
  if (provider.credential.status === 'unavailable') {
    return '状态不可用';
  }
  return '未登录';
}

function accountDescription(provider: AgentProviderSnapshot): string {
  if (provider.credential.status === 'unavailable') {
    return provider.credential.message;
  }

  if (provider.credential.status === 'unauthenticated') {
    return '未检测到可用账号';
  }

  const account = provider.credential.account;
  const details = [
    account.email,
    account.planType ? `${account.planType} 计划` : undefined,
  ].filter((value): value is string => value !== undefined);

  return details.length > 0
    ? details.join(' · ')
    : '账号可用';
}

export function AgentProviderCard({
  provider,
  loginChallenge,
  busy,
  checking,
  selectedActionLabel,
  onLogin,
  onSelect,
  onRefresh,
  onReopenLogin,
}: AgentProviderCardProps) {
  const credential = provider.credential;
  const awaitingLogin =
    loginChallenge?.providerId === provider.id;

  return (
    <article className="rounded-[18px] border border-white/[0.09] bg-white/[0.025] p-5">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-slate-100">
              {provider.displayName}
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                credential.status === 'authenticated'
                  ? 'bg-emerald-300/10 text-emerald-200'
                  : credential.status === 'unavailable'
                    ? 'bg-rose-300/10 text-rose-200'
                    : 'bg-white/[0.06] text-slate-400'
              }`}
            >
              {credentialLabel(provider)}
            </span>
            {provider.selected && (
              <span className="rounded-full border border-indigo-200/15 px-2 py-0.5 text-[10px] text-indigo-200">
                已选择
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {provider.description}
          </p>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            {accountDescription(provider)}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {credential.status === 'authenticated' ? (
            !provider.selected || selectedActionLabel ? (
              <button
                type="button"
                disabled={busy || checking}
                onClick={onSelect}
                className="ui-primary-button h-9 rounded-full bg-slate-50 px-4 text-xs font-semibold text-slate-900 disabled:opacity-40"
              >
                {busy
                  ? '正在验证…'
                  : provider.selected
                    ? selectedActionLabel
                    : `选择 ${provider.displayName}`}
              </button>
            ) : null
          ) : credential.status === 'unauthenticated' ? (
            <button
              type="button"
              disabled={busy || awaitingLogin || checking}
              onClick={onLogin}
              className="ui-primary-button h-9 rounded-full bg-slate-50 px-4 text-xs font-semibold text-slate-900 disabled:opacity-40"
            >
              {busy
                ? '正在启动…'
                : awaitingLogin
                  ? '等待登录…'
                  : provider.loginLabel}
            </button>
          ) : (
            <button
              type="button"
              disabled={checking}
              onClick={onRefresh}
              className="ui-control h-9 rounded-full border border-white/[0.12] px-4 text-xs text-slate-300 disabled:opacity-40"
            >
              {checking ? '正在检查…' : '重新检查'}
            </button>
          )}
        </div>
      </div>

      {awaitingLogin && (
        <div className="mt-4 rounded-xl border border-indigo-200/10 bg-indigo-300/[0.04] px-3.5 py-3 text-xs leading-5 text-indigo-100/80">
          <p>
            完成浏览器登录后将自动检查。
          </p>
          {loginChallenge.type === 'device-code' && (
            <p className="mt-2 font-mono text-sm tracking-wider text-indigo-100">
              {loginChallenge.userCode}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onReopenLogin}
              className="ui-control text-xs text-indigo-200 underline decoration-indigo-300/30 underline-offset-4"
            >
              重新打开登录页面
            </button>
            <button
              type="button"
              disabled={checking}
              onClick={onRefresh}
              className="ui-control text-xs text-indigo-200 underline decoration-indigo-300/30 underline-offset-4 disabled:opacity-40"
            >
              {checking ? '正在检查…' : '立即检查登录状态'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
