import { useEffect, useRef } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import '../../markdown/markdown-workbench.css';

import { normalizeConversationMarkdown } from '../../../renderer/conversation/conversation-text';
import {
  MARKDOWN_PREVIEW_RENDER_POLICY,
  resolveVditorResourceBaseUrl,
  sanitizeMarkdownRenderedHtml,
} from '../../markdown/markdown-editor-adapter';
import { formatVideoExplanationTime } from './video-explanation-index';
import type { VideoExplanationRuntimeView } from './video-explanation-runtime';
import type { VideoExplanationView } from './shared';

function MarkdownAnswer({ markdown }: { readonly markdown: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.textContent = '';
    void Vditor.preview(host, normalizeConversationMarkdown(markdown), {
      cdn: resolveVditorResourceBaseUrl(),
      mode: 'dark',
      markdown: { sanitize: true },
      render: MARKDOWN_PREVIEW_RENDER_POLICY,
      transform: sanitizeMarkdownRenderedHtml,
    }).catch((error: unknown) => {
      console.error('渲染视频 AI 解释 Markdown 失败', error);
      host.textContent = markdown;
    });
  }, [markdown]);
  return (
    <div
      ref={hostRef}
      data-video-explanation-markdown
      className="vditor-reset text-[13px] leading-6 text-slate-200 [&_.katex]:!text-white [&_.katex]:!opacity-100 [&_.language-math]:!text-white [&_.language-math]:!opacity-100 [&_a]:text-indigo-300 [&_code]:rounded [&_code]:bg-black/20 [&_code]:px-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm"
    />
  );
}

export function VideoExplanationPanel({
  explanation,
  runtime,
  onClose,
  onRetry,
  onDelete,
  onContinueQuestion,
  continueQuestionDisabled = false,
}: {
  readonly explanation: VideoExplanationView;
  readonly runtime?: VideoExplanationRuntimeView;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onDelete: () => void;
  readonly onContinueQuestion?: () => void;
  readonly continueQuestionDisabled?: boolean;
}) {
  const region = explanation.target.targetPayload;
  return (
    <aside
      aria-label="视频 AI 解释"
      className="learning-markdown-workbench absolute right-4 top-4 z-30 flex max-h-[calc(100%-2rem)] w-[min(400px,calc(100%-2rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#20262e]/95 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-slate-100">
            解释视频画面区域
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {formatVideoExplanationTime(region.timeSeconds)} · 左侧{' '}
            {Math.round(region.x * 100)}% · 顶部 {Math.round(region.y * 100)}%
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭视频 AI 解释"
          onClick={onClose}
          className="ui-icon-button grid size-7 place-items-center rounded-full text-sm text-slate-500"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-[10px] leading-5 text-slate-500">
          已暂停并定位到标注对应的视频帧。画面上的编号区域是 AI
          解释的兴趣区域。
        </div>
        <div className="mb-4 rounded-xl border border-indigo-300/10 bg-indigo-300/[0.04] px-3 py-2.5">
          <p className="text-[10px] font-medium text-indigo-200/70">问题</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-300">
            {explanation.question}
          </p>
        </div>
        {explanation.status === 'pending' && (
          <div className="text-xs text-slate-300">
            <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-400">
              <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
              {runtime?.statusMessage ?? '正在理解当前视频帧与兴趣区域…'}
            </div>
            {runtime?.text && (
              <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-200">
                {runtime.text}
                {runtime.phase !== 'saving' && (
                  <span className="ml-0.5 inline-block h-3 w-[6px] animate-pulse bg-indigo-300 align-[-2px]" />
                )}
              </div>
            )}
          </div>
        )}
        {explanation.status === 'completed' && (
          <MarkdownAnswer markdown={explanation.answer || '回答内容暂时不可用。'} />
        )}
        {explanation.status === 'failed' && (
          <div>
            {runtime?.text && (
              <div className="mb-3 rounded-lg border border-amber-200/15 bg-amber-200/[0.04] p-3 text-[12px] leading-5 text-slate-300">
                {runtime.text}
              </div>
            )}
            <p className="text-xs leading-5 text-rose-300">
              {explanation.failureMessage ?? '视频 AI 解释失败，请重试。'}
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
      <div className="flex shrink-0 items-center justify-between border-t border-white/[0.07] px-3 py-2">
        {explanation.status === 'completed' && onContinueQuestion ? (
          <button
            type="button"
            disabled={continueQuestionDisabled}
            onClick={onContinueQuestion}
            className="ui-control rounded-full border border-indigo-300/15 bg-indigo-300/[0.06] px-3 py-1.5 text-[11px] text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            继续追问
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onDelete}
          className="ui-control rounded-full border border-rose-300/15 bg-rose-300/[0.04] px-3 py-1.5 text-[11px] text-rose-300/80 hover:border-rose-300/30 hover:text-rose-200"
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
