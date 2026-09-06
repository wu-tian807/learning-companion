import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

import type { ProjectLearningNoteController } from './use-project-learning-note';

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

function statusLabel(controller: ProjectLearningNoteController): string {
  if (controller.loadState.kind === 'loading') return '正在读取';
  switch (controller.saveState) {
    case 'saving':
      return '正在保存…';
    case 'dirty':
      return '等待保存';
    case 'error':
      return '保存失败';
    case 'saved':
      return controller.updatedTime === null ? '尚未写入' : '已自动保存';
  }
}

export function ProjectLearningNotePanel({
  controller,
  onClose,
}: {
  readonly controller: ProjectLearningNoteController;
  readonly onClose: () => void;
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const ready = controller.loadState.kind === 'ready';

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-[17px] border border-white/10 bg-[#20242b] shadow-xl">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-100">
            学习笔记
          </h2>
          <p
            className={[
              'mt-0.5 text-[10px]',
              controller.saveState === 'error'
                ? 'text-rose-300'
                : 'text-slate-500',
            ].join(' ')}
          >
            {statusLabel(controller)} · 当前 Project 跨资料共享
          </p>
        </div>
        <button
          type="button"
          aria-label="收起学习笔记"
          onClick={onClose}
          className="ui-icon-button grid size-8 shrink-0 place-items-center rounded-[10px] border border-white/10 text-slate-400"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 px-3 py-2">
        <div className="flex rounded-lg bg-black/20 p-0.5">
          {(['edit', 'preview'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
              className={[
                'rounded-md px-3 py-1.5 text-[11px] transition-colors',
                mode === candidate
                  ? 'bg-indigo-400/18 text-indigo-100'
                  : 'text-slate-500 hover:text-slate-300',
              ].join(' ')}
            >
              {candidate === 'edit' ? 'Markdown 编辑' : '预览'}
            </button>
          ))}
        </div>
        <span className="text-[10px] tabular-nums text-slate-600">
          {controller.markdown.length.toLocaleString()} /{' '}
          {controller.maxLength.toLocaleString()}
        </span>
      </div>

      {controller.loadState.kind === 'loading' ? (
        <div className="grid min-h-0 flex-1 place-items-center text-xs text-slate-500">
          正在读取学习笔记…
        </div>
      ) : controller.loadState.kind === 'error' ? (
        <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
          <div>
            <p className="text-xs text-rose-200">
              {controller.loadState.message}
            </p>
            <button
              type="button"
              onClick={() => void controller.retry().catch(() => undefined)}
              className="mt-3 rounded-md border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-white/5"
            >
              重新读取
            </button>
          </div>
        </div>
      ) : mode === 'edit' ? (
        <textarea
          aria-label="Markdown 学习笔记编辑器"
          value={controller.markdown}
          maxLength={controller.maxLength}
          spellCheck={false}
          placeholder={'# 学习笔记\n\n记录跨资料的概念、问题和思考…'}
          onChange={(event) => controller.setMarkdown(event.target.value)}
          onBlur={() => void controller.flush().catch(() => undefined)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 's') {
              event.preventDefault();
              void controller.flush().catch(() => undefined);
            }
          }}
          disabled={!ready}
          className="min-h-0 flex-1 resize-none border-0 bg-transparent px-4 py-4 font-mono text-[13px] leading-6 text-slate-200 outline-none placeholder:text-slate-600 disabled:cursor-wait"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {controller.markdown.trim() ? (
            <div className="select-text break-words text-[13px] leading-6 text-slate-300 [&_a]:text-indigo-300 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-400/40 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 [&_code]:rounded [&_code]:bg-black/25 [&_code]:px-1 [&_code]:font-mono [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-white [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-slate-100 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/25 [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5">
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      onClick={(event) => {
                        event.preventDefault();
                        if (
                          href?.startsWith('http://') ||
                          href?.startsWith('https://')
                        ) {
                          void window.learningCompanion
                            .openExternal({ url: href })
                            .catch(() => undefined);
                        }
                      }}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {controller.markdown}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="grid h-full place-items-center text-center text-xs text-slate-600">
              输入 Markdown 后可在这里查看排版效果。
            </div>
          )}
        </div>
      )}

      {controller.error && controller.loadState.kind === 'ready' && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-rose-300/15 bg-rose-400/8 px-3 py-2">
          <p className="min-w-0 text-[10px] text-rose-200">
            {controller.error}
          </p>
          <button
            type="button"
            onClick={() => void controller.retry().catch(() => undefined)}
            className="shrink-0 rounded-md border border-rose-200/20 px-2 py-1 text-[10px] text-rose-100 hover:bg-rose-300/10"
          >
            重试
          </button>
        </div>
      )}
    </aside>
  );
}
