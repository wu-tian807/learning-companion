import type { ReactNode } from 'react';

import type { AgentProviderSnapshot } from '../../shared/agent-providers';

interface AgentProviderCardProps {
  readonly provider: AgentProviderSnapshot;
  readonly children: ReactNode;
}

export function AgentProviderCard({
  provider,
  children,
}: AgentProviderCardProps) {
  const readyCount = provider.connections.filter(
    (connection) => connection.status === 'ready',
  ).length;

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
                readyCount > 0
                  ? 'bg-emerald-300/10 text-emerald-200'
                  : 'bg-white/[0.06] text-slate-400'
              }`}
            >
              {readyCount > 0 ? `${readyCount} 个连接可用` : '尚无可用连接'}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {provider.description}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2.5 border-t border-white/[0.07] pt-4">
        {children}
      </div>
    </article>
  );
}
