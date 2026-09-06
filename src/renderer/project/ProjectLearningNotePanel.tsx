import { useCallback, useEffect, useRef, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import type { AssetAttachment } from '../../shared/attachments/contracts';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  parseProjectLearningNoteReferenceHref,
  type ProjectLearningNoteReferenceLink,
} from '../../shared/project-learning-notes';
import type { MarkdownEditorAdapter } from '../../workbenches/markdown/markdown-editor-adapter';
import { useMarkdownVisualEditor } from '../../workbenches/markdown/use-markdown-visual-editor';
import '../../workbenches/markdown/markdown-workbench.css';

import {
  createLearningNoteAttachmentMarkdown,
  projectLearningNoteAttachmentOptionLabel,
} from './project-learning-note-links';
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
  active,
  projectId,
  selectedAsset,
  controller,
  onRevealReference,
  onClose,
}: {
  readonly active: boolean;
  readonly projectId: string;
  readonly selectedAsset: AssetSnapshot | undefined;
  readonly controller: ProjectLearningNoteController;
  readonly onRevealReference: (
    link: ProjectLearningNoteReferenceLink,
  ) => Promise<void>;
  readonly onClose: () => void;
}) {
  const editorRef = useRef<MarkdownEditorAdapter | undefined>(undefined);
  const [editorKey, setEditorKey] = useState(0);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<readonly AssetAttachment[]>([]);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState('');
  const attachmentLoadRevisionRef = useRef(0);
  const ready = controller.loadState.kind === 'ready';
  const { hostRef, state: editorState } = useMarkdownVisualEditor({
    enabled: active && ready,
    resetKey: `${projectId}:${editorKey}`,
    initialValue: controller.markdown,
    initialScrollTop: 0,
    outlineVisible: false,
    onInput: (markdown) => {
      if (markdown.length > controller.maxLength) {
        editorRef.current?.setValue(controller.markdown);
        setInteractionError('学习笔记内容超过长度限制。');
        return;
      }
      controller.setMarkdown(markdown);
    },
    onScroll: () => undefined,
    onOpenExternal: (url) => {
      void window.learningCompanion.openExternal({ url }).catch((error) => {
        setInteractionError(
          userMessageFromError(error, '无法打开外部链接。') ??
            '无法打开外部链接。',
        );
      });
    },
    isInternalLinkAllowed: (href) =>
      parseProjectLearningNoteReferenceHref(href) !== undefined,
    onOpenInternalLink: (href) => {
      const link = parseProjectLearningNoteReferenceHref(href);
      if (!link || link.projectId !== projectId) {
        setInteractionError('这条资料引用不属于当前 Project。');
        return;
      }
      setInteractionError(null);
      void onRevealReference(link).catch((error) => {
        setInteractionError(
          userMessageFromError(error, '无法定位引用的资料。') ??
            '无法定位引用的资料。',
        );
      });
    },
    onError: (error) => {
      setInteractionError(
        userMessageFromError(error, 'Markdown 编辑器运行异常。') ??
          'Markdown 编辑器运行异常。',
      );
    },
    onAdapterChange: (adapter) => {
      editorRef.current = adapter;
    },
  });

  const loadAttachments = useCallback(async () => {
    const asset = selectedAsset;
    const revision = ++attachmentLoadRevisionRef.current;
    if (!active || !asset) {
      setAttachments([]);
      setSelectedAttachmentId('');
      setAttachmentLoading(false);
      return;
    }
    setAttachmentLoading(true);
    try {
      const listed = await window.learningCompanion.listAttachments({
        projectId,
        assetId: asset.id,
      });
      if (revision !== attachmentLoadRevisionRef.current) return;
      const owned = listed.filter(
        (attachment) =>
          attachment.projectId === projectId &&
          attachment.assetId === asset.id &&
          attachment.target.scope === 'content',
      );
      setAttachments(owned);
      setSelectedAttachmentId((current) =>
        owned.some((attachment) => attachment.id === current)
          ? current
          : (owned[0]?.id ?? ''),
      );
    } catch (error) {
      if (revision !== attachmentLoadRevisionRef.current) return;
      setAttachments([]);
      setSelectedAttachmentId('');
      setInteractionError(
        userMessageFromError(error, '无法读取当前资料的标注。') ??
          '无法读取当前资料的标注。',
      );
    } finally {
      if (revision === attachmentLoadRevisionRef.current) {
        setAttachmentLoading(false);
      }
    }
  }, [active, projectId, selectedAsset]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadAttachments();
    });
    return () => {
      cancelled = true;
      attachmentLoadRevisionRef.current += 1;
    };
  }, [loadAttachments]);

  const insertSelectedAttachment = () => {
    const asset = selectedAsset;
    const attachment = attachments.find(
      (candidate) => candidate.id === selectedAttachmentId,
    );
    if (!asset || !attachment) {
      setInteractionError('请先选择当前资料中要引用的标注。');
      return;
    }
    const editor = editorRef.current;
    if (!editor || editorState !== 'ready') {
      setInteractionError('Markdown 编辑器尚未准备好。');
      return;
    }

    editor.insertMarkdown(
      createLearningNoteAttachmentMarkdown(asset.name, attachment),
    );
    editor.focus();
    setInteractionError(null);
  };

  const visibleError = interactionError ?? controller.error;

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
            {statusLabel(controller)} · 当前 Project 跨资料共享 ·{' '}
            {controller.markdown.length.toLocaleString()} 字符
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

      <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-3 py-2">
        <select
          aria-label="选择要引用的标注"
          value={selectedAttachmentId}
          disabled={!selectedAsset || attachmentLoading || attachments.length === 0}
          onChange={(event) => setSelectedAttachmentId(event.target.value)}
          className="ui-control min-w-0 flex-1 rounded-lg border border-white/10 bg-[#1b2027] px-2 py-1.5 text-[11px] text-slate-300 outline-none disabled:cursor-not-allowed disabled:opacity-45"
        >
          {attachmentLoading ? (
            <option value="">正在读取标注…</option>
          ) : attachments.length === 0 ? (
            <option value="">当前资料暂无可定位标注</option>
          ) : (
            attachments.map((attachment) => (
              <option key={attachment.id} value={attachment.id}>
                {projectLearningNoteAttachmentOptionLabel(attachment)}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          aria-label="刷新可引用标注"
          disabled={!selectedAsset || attachmentLoading}
          onClick={() => void loadAttachments()}
          className="ui-icon-button grid size-7 shrink-0 place-items-center rounded-lg border border-white/10 text-sm text-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
          title="刷新当前资料的 Attachment 列表"
        >
          ↻
        </button>
        <button
          type="button"
          disabled={
            !ready ||
            editorState !== 'ready' ||
            !selectedAttachmentId
          }
          onClick={insertSelectedAttachment}
          className="ui-control shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-indigo-200 hover:border-indigo-300/35 hover:bg-indigo-300/10 disabled:cursor-not-allowed disabled:opacity-40"
          title="把所选 Attachment 及其原文定位插入学习笔记"
        >
          + 引用标注
        </button>
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
      ) : (
        <div
          aria-label="Markdown 学习笔记编辑器"
          onKeyDownCapture={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 's') {
              event.preventDefault();
              void controller.flush().catch(() => undefined);
            }
          }}
          className="relative min-h-0 flex-1 overflow-hidden bg-[#1b2027]"
        >
          <div
            ref={hostRef}
            className="learning-markdown-workbench h-full min-h-0 [&_.vditor]:h-full [&_.vditor]:border-0 [&_.vditor]:bg-[#1b2027] [&_.vditor-content]:min-h-0 [&_.vditor-content]:bg-[#1b2027] [&_.vditor-toolbar]:overflow-x-auto [&_.vditor-toolbar]:border-white/[0.08] [&_.vditor-toolbar]:bg-[#222831] [&_.vditor-wysiwyg]:bg-[#1b2027]"
          />
          {editorState === 'loading' && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#1b2027] text-xs text-slate-500">
              正在启动 Markdown 编辑器…
            </div>
          )}
          {editorState === 'failed' && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div>
                <p className="text-xs text-rose-200">
                  Markdown 编辑器加载失败
                </p>
                <button
                  type="button"
                  onClick={() => setEditorKey((current) => current + 1)}
                  className="mt-3 rounded-md border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-white/5"
                >
                  重试
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {visibleError && controller.loadState.kind === 'ready' && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-rose-300/15 bg-rose-400/8 px-3 py-2">
          <p className="min-w-0 text-[10px] text-rose-200">
            {visibleError}
          </p>
          {controller.error && !interactionError && (
            <button
              type="button"
              onClick={() => void controller.retry().catch(() => undefined)}
              className="shrink-0 rounded-md border border-rose-200/20 px-2 py-1 text-[10px] text-rose-100 hover:bg-rose-300/10"
            >
              重试
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
