import { useEffect, useRef } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import '../../markdown/markdown-workbench.css';

import {
  MARKDOWN_PREVIEW_RENDER_POLICY,
  resolveVditorResourceBaseUrl,
  sanitizeMarkdownRenderedHtml,
} from '../../markdown/markdown-editor-adapter';
import type { EpubExplanationView } from './shared';
import type { EpubExplanationRuntimeView } from './epub-explanation-runtime';

function MarkdownAnswer({ markdown }: { readonly markdown: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.textContent = '';
    void Vditor.preview(host, markdown, {
      cdn: resolveVditorResourceBaseUrl(),
      mode: 'dark',
      markdown: { sanitize: true },
      render: MARKDOWN_PREVIEW_RENDER_POLICY,
      transform: sanitizeMarkdownRenderedHtml,
    }).catch((error: unknown) => {
      console.error('渲染 EPUB 解释 Markdown 失败', error);
      host.textContent = markdown;
    });
  }, [markdown]);

  return (
    <div
      ref={hostRef}
      className="vditor-reset text-[13px] leading-6 text-slate-200 [&_a]:text-indigo-300 [&_code]:rounded [&_code]:bg-black/20 [&_code]:px-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm"
    />
  );
}

export function EpubExplanationPanel({
  explanation,
  runtime,
  onClose,
  onRetry,
  onDelete,
}: {
  readonly explanation: EpubExplanationView;
  readonly runtime?: EpubExplanationRuntimeView;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <aside
      aria-label="AI 解释"
      className="learning-markdown-workbench absolute right-4 top-4 z-20 w-[min(380px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#20262e]/95 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-slate-100">解释这段话</p>
          <p className="mt-0.5 max-w-[280px] truncate text-[10px] text-slate-500">
            “{explanation.target.anchorPayload.quote.exact}”
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭 AI 解释"
          onClick={onClose}
          className="ui-icon-button grid size-7 place-items-center rounded-full text-sm text-slate-500"
        >
          ×
        </button>
      </div>

      <div className="max-h-[min(55vh,460px)] overflow-y-auto px-4 py-4">
        {explanation.status === 'pending' && (
          <div className="text-xs text-slate-300">
            <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-400">
              <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
              {runtime?.statusMessage ?? 'AI 正在解释选中的文字…'}
            </div>
            {runtime?.text && (
              <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-200">
                {runtime.text}
                {runtime.phase !== 'saving' && (
                  <span
                    data-epub-explanation-stream-caret
                    className="ml-0.5 inline-block h-3 w-[6px] animate-pulse bg-indigo-300 align-[-2px]"
                  />
                )}
              </div>
            )}
          </div>
        )}
        {explanation.status === 'completed' && (
          <MarkdownAnswer
            markdown={explanation.answer ?? '回答内容暂时不可用。'}
          />
        )}
        {explanation.status === 'failed' && (
          <div>
            {runtime?.text && (
              <div className="mb-3 rounded-lg border border-amber-200/15 bg-amber-200/[0.04] p-3">
                <p className="mb-2 text-[10px] font-medium text-amber-200/80">
                  未完成，内容尚未保存
                </p>
                <div className="whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-300">
                  {runtime.text}
                </div>
              </div>
            )}
            <p className="text-xs leading-5 text-rose-300">
              {explanation.failureMessage ?? 'AI 解释失败，请重试。'}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="ui-control mt-3 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300"
            >
              重新生成
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-white/[0.07] px-3 py-2">
        <button
          type="button"
          onClick={onDelete}
          className="ui-control rounded-full px-3 py-1.5 text-[11px] text-slate-500 hover:text-rose-300"
        >
          {explanation.kind === 'attachment'
            ? '删除解释'
            : explanation.status === 'pending'
              ? '取消生成'
              : '移除任务'}
        </button>
      </div>
    </aside>
  );
}
