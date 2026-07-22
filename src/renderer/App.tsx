import { useEffect, useState } from 'react';

import type { HealthCheckResponse } from '../shared/ipc';
import { isHealthCheckResponse } from '../shared/ipc';

type ConnectionState =
  | { kind: 'connecting' }
  | { kind: 'connected'; health: HealthCheckResponse }
  | { kind: 'failed' };

const statusStyles: Record<ConnectionState['kind'], string> = {
  connecting: 'bg-amber-300/10 text-amber-200 ring-amber-200/20',
  connected: 'bg-emerald-300/10 text-emerald-200 ring-emerald-200/20',
  failed: 'bg-rose-300/10 text-rose-200 ring-rose-200/20',
};

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const label = {
    connecting: '正在连接本地后端',
    connected: '本地后端已连接',
    failed: '本地后端连接失败',
  }[state.kind];

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${statusStyles[state.kind]}`}
    >
      <span className="relative flex size-1.5">
        {state.kind === 'connecting' && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
        )}
        <span className="relative inline-flex size-1.5 rounded-full bg-current" />
      </span>
      {label}
    </div>
  );
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({ kind: 'connecting' });

  useEffect(() => {
    let active = true;

    const connect = async () => {
      try {
        const health = await window.learningCompanion.healthCheck();

        if (!isHealthCheckResponse(health)) {
          throw new Error('本地后端返回了无效响应');
        }

        if (active) {
          setConnection({ kind: 'connected', health });
        }
      } catch (error) {
        console.error('连接本地后端失败', error);

        if (active) {
          setConnection({ kind: 'failed' });
        }
      }
    };

    void connect();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="flex h-screen min-h-[600px] flex-col overflow-hidden bg-[#090c11] text-slate-100">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.07] px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-400 to-cyan-300 text-sm font-bold text-slate-950 shadow-lg shadow-indigo-950/30">
            L
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Learning Companion</h1>
            <p className="mt-0.5 text-[11px] text-slate-500">阅读、提问与沉淀</p>
          </div>
        </div>

        <ConnectionBadge state={connection} />
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)] gap-3 p-3">
        <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] shadow-2xl shadow-black/10">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <span className="size-2 rounded-full bg-indigo-300/70" />
              文档阅读区
            </div>
            <span className="rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-slate-500">
              尚未打开文档
            </span>
          </div>

          <div className="grid flex-1 place-items-center p-8">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.035] text-2xl text-slate-500">
                文
              </div>
              <h2 className="text-sm font-medium text-slate-300">阅读能力将在这里生长</h2>
              <p className="mt-2 text-xs leading-6 text-slate-600">
                后续接入 PDF、Markdown、网页与 EPUB，并让选区成为 AI 提问上下文。
              </p>
            </div>
          </div>
        </article>

        <aside className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1118] shadow-2xl shadow-black/10">
          <div className="flex h-12 shrink-0 items-center border-b border-white/[0.06] px-2">
            <button
              type="button"
              className="rounded-lg bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-slate-200"
            >
              AI 对话
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-medium text-slate-600"
            >
              笔记
            </button>
          </div>

          <div className="flex flex-1 flex-col justify-between p-4">
            <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-5">
              <p className="text-xs font-medium text-slate-400">助手区域已就绪</p>
              <p className="mt-2 text-[11px] leading-5 text-slate-600">
                Codex 接入、流式回答和自动笔记将在后续迭代中加入。
              </p>
            </div>

            <div>
              {connection.kind === 'connected' && (
                <p className="mb-2 px-1 text-[10px] text-slate-600">
                  v{connection.health.appVersion} · {connection.health.platform}
                </p>
              )}
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-2">
                <span className="flex-1 px-2 text-xs text-slate-600">打开文档后即可提问…</span>
                <button
                  type="button"
                  disabled
                  className="rounded-lg bg-white/[0.06] px-3 py-2 text-[11px] font-medium text-slate-600"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
