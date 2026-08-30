import { useState } from 'react';

import type { HtmlDraftReview, HtmlEditingStatus } from '../shared';

interface HtmlDraftToolbarProps {
  readonly status: HtmlEditingStatus;
  readonly busy: boolean;
  readonly review: HtmlDraftReview | undefined;
  readonly onUndo: () => Promise<void>;
  readonly onRedo: () => Promise<void>;
  readonly onReview: () => Promise<void>;
  readonly onSync: () => Promise<void>;
  readonly onDiscard: () => Promise<void>;
  readonly onCloseReview: () => void;
}

function statusLabel(status: HtmlEditingStatus): string {
  if (status.conflict) return '草稿与原件冲突';
  if (status.pending) return 'AI 正在修改';
  if (status.syncRequested) return '等待同步';
  return `草稿 · ${status.stepCount} 步 · ${status.changeCount} 处`;
}

export function HtmlDraftToolbar({
  status,
  busy,
  review,
  onUndo,
  onRedo,
  onReview,
  onSync,
  onDiscard,
  onCloseReview,
}: HtmlDraftToolbarProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  if (!status.hasDraft && !status.pending) return null;

  return (
    <>
      <div
        role="toolbar"
        aria-label="HTML 草稿操作"
        className="absolute left-1/2 top-3 z-20 flex h-9 max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 rounded-md border border-white/10 bg-[#171d24]/95 px-1.5 text-xs text-slate-300 shadow-lg backdrop-blur-sm"
      >
        <span
          className={`mx-1 size-1.5 shrink-0 rounded-full ${
            status.conflict
              ? 'bg-rose-400'
              : status.pending
                ? 'animate-pulse bg-sky-300'
                : status.syncRequested
                  ? 'animate-pulse bg-amber-300'
                  : 'bg-emerald-400'
          }`}
        />
        <span className="max-w-44 truncate px-1 font-medium text-slate-200">
          {statusLabel(status)}
        </span>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <button
          type="button"
          aria-label="撤销上一步"
          title="撤销"
          disabled={busy || !status.canUndo}
          onClick={() => void onUndo()}
          className="ui-control grid size-7 shrink-0 place-items-center rounded text-base leading-none text-slate-300 disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↶
        </button>
        <button
          type="button"
          aria-label="重做下一步"
          title="重做"
          disabled={busy || !status.canRedo}
          onClick={() => void onRedo()}
          className="ui-control grid size-7 shrink-0 place-items-center rounded text-base leading-none text-slate-300 disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↷
        </button>
        <button
          type="button"
          aria-label="查看 HTML 更改"
          disabled={busy || status.changeCount === 0}
          onClick={() => void onReview()}
          className="ui-control h-7 shrink-0 rounded px-2 text-[11px] text-slate-300 disabled:opacity-30"
        >
          查看更改
        </button>
        <button
          type="button"
          aria-label="同步 HTML 草稿"
          disabled={busy || !status.unsynced || Boolean(status.conflict)}
          onClick={() => void onSync()}
          className="ui-control h-7 shrink-0 rounded bg-sky-400/12 px-2 text-[11px] font-medium text-sky-200 disabled:opacity-30"
        >
          {status.syncRequested ? '已排队' : '同步'}
        </button>
        {confirmDiscard ? (
          <div className="flex h-7 shrink-0 items-center gap-1 pl-1">
            <span className="text-[11px] text-rose-200">放弃全部？</span>
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="ui-control h-6 rounded px-1.5 text-[11px] text-slate-300"
            >
              取消
            </button>
            <button
              type="button"
              aria-label="确认放弃 HTML 草稿"
              disabled={busy}
              onClick={() => {
                void onDiscard().then(() => setConfirmDiscard(false));
              }}
              className="ui-control h-6 rounded bg-rose-400/14 px-1.5 text-[11px] text-rose-200"
            >
              确认
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="放弃 HTML 草稿"
            disabled={busy || status.pending}
            onClick={() => setConfirmDiscard(true)}
            className="ui-control h-7 shrink-0 rounded px-2 text-[11px] text-slate-500 hover:text-rose-200 disabled:opacity-30"
          >
            放弃
          </button>
        )}
      </div>

      {review && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="HTML 草稿更改"
          className="absolute inset-0 z-30 flex items-center justify-center bg-[#0c1117]/72 p-5 backdrop-blur-[2px]"
        >
          <section className="flex max-h-[min(78vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#171d24] shadow-2xl">
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/8 px-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">HTML 草稿更改</h3>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {review.entries.length} 个历史步骤
                  {review.pendingChanges.length > 0
                    ? ` · 当前轮 ${review.pendingChanges.length} 处`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭 HTML 更改"
                title="关闭"
                onClick={onCloseReview}
                className="ui-control grid size-7 place-items-center rounded text-lg leading-none text-slate-400"
              >
                ×
              </button>
            </header>
            <div className="min-h-0 overflow-auto px-4 py-2">
              {[
                ...review.entries.flatMap((entry) => entry.changes),
                ...review.pendingChanges,
              ].map((change, index) => (
                <div
                  key={`${index}:${change.before.length}:${change.after.length}`}
                  className="grid gap-3 border-b border-white/7 py-3 last:border-b-0 md:grid-cols-2"
                >
                  <div className="min-w-0">
                    <p className="mb-1.5 text-[10px] font-medium text-rose-300/80">
                      修改前
                    </p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/18 p-2.5 font-mono text-[11px] leading-5 text-slate-400">
                      {change.before || '（空）'}
                    </pre>
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1.5 text-[10px] font-medium text-emerald-300/80">
                      修改后
                    </p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/18 p-2.5 font-mono text-[11px] leading-5 text-slate-200">
                      {change.after || '（空）'}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
