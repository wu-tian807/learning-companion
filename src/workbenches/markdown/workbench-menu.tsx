import { useEffect, useRef, useState } from 'react';

import type {
  MarkdownEncoding,
  MarkdownLineEnding,
  MarkdownWorkbenchViewState,
} from './shared';

interface MarkdownWorkbenchMenuProps {
  readonly disabled: boolean;
  readonly encodingDisabled: boolean;
  readonly encoding: MarkdownEncoding;
  readonly lineEnding: MarkdownLineEnding;
  readonly viewState: MarkdownWorkbenchViewState;
  readonly onSetEncoding: (encoding: MarkdownEncoding) => Promise<void>;
  readonly onSetLineEnding: (
    lineEnding: MarkdownLineEnding,
  ) => Promise<void>;
  readonly onSetViewState: (
    state: MarkdownWorkbenchViewState,
  ) => Promise<void>;
  readonly onReveal: () => Promise<void> | void;
}

export interface MarkdownSourceContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly busy: boolean;
  readonly hasSelection: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onClose: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onCut: () => void;
  readonly onCopy: () => void;
  readonly onPaste: () => void;
  readonly onFind: () => void;
  readonly onSelectAll: () => void;
}

export function MarkdownSourceContextMenu({
  x,
  y,
  busy,
  hasSelection,
  canUndo,
  canRedo,
  onClose,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onFind,
  onSelectAll,
}: MarkdownSourceContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', onClose);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const itemClass =
    'ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Markdown 源码编辑菜单"
      className="absolute z-50 w-56 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.5)]"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        role="menuitem"
        disabled={busy || !canUndo}
        onClick={onUndo}
        className={itemClass}
      >
        <span>撤销</span>
        <span className="text-slate-500">⌘/Ctrl Z</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={busy || !canRedo}
        onClick={onRedo}
        className={itemClass}
      >
        <span>重做</span>
        <span className="text-slate-500">⇧ ⌘/Ctrl Z</span>
      </button>

      <div className="my-1 h-px bg-white/[0.08]" />
      <button
        type="button"
        role="menuitem"
        disabled={busy || !hasSelection}
        onClick={onCut}
        className={itemClass}
      >
        <span>剪切</span>
        <span className="text-slate-500">⌘/Ctrl X</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={busy || !hasSelection}
        onClick={onCopy}
        className={itemClass}
      >
        <span>复制</span>
        <span className="text-slate-500">⌘/Ctrl C</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={onPaste}
        className={itemClass}
      >
        <span>粘贴</span>
        <span className="text-slate-500">⌘/Ctrl V</span>
      </button>

      <div className="my-1 h-px bg-white/[0.08]" />
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={onFind}
        className={itemClass}
      >
        <span>查找</span>
        <span className="text-slate-500">⌘/Ctrl F</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={onSelectAll}
        className={itemClass}
      >
        <span>全选</span>
        <span className="text-slate-500">⌘/Ctrl A</span>
      </button>
    </div>
  );
}

export function MarkdownWorkbenchMenu({
  disabled,
  encodingDisabled,
  encoding,
  lineEnding,
  viewState,
  onSetEncoding,
  onSetLineEnding,
  onSetViewState,
  onReveal,
}: MarkdownWorkbenchMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const run = async (
    operation: () => Promise<void> | void,
    closeAfter = false,
  ) => {
    setBusy(true);
    try {
      await operation();
      if (closeAfter) {
        setOpen(false);
      }
    } catch {
      // Renderer callbacks already report user-facing failures.
    } finally {
      setBusy(false);
    }
  };
  const itemClass =
    'ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Markdown 工作台选项"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="ui-icon-button grid h-[26px] min-w-[32px] place-items-center rounded-lg border border-white/[0.08] px-2 text-xs tracking-[0.1em] text-slate-400 disabled:cursor-not-allowed disabled:opacity-35"
        title={disabled ? '当前暂时不能修改选项' : 'Markdown 选项'}
      >
        •••
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Markdown 编辑器选项"
          className="absolute top-8 right-0 z-40 w-60 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.48)]"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={viewState.outlineVisible}
            disabled={busy}
            onClick={() =>
              void run(() =>
                onSetViewState({
                  ...viewState,
                  outlineVisible: !viewState.outlineVisible,
                }),
              )
            }
            className={itemClass}
          >
            <span>显示大纲</span>
            <span className="text-indigo-200">
              {viewState.outlineVisible ? '✓' : ''}
            </span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={viewState.wordWrap}
            disabled={busy}
            onClick={() =>
              void run(() =>
                onSetViewState({
                  ...viewState,
                  wordWrap: !viewState.wordWrap,
                }),
              )
            }
            className={itemClass}
          >
            <span>源码自动换行</span>
            <span className="text-indigo-200">
              {viewState.wordWrap ? '✓' : ''}
            </span>
          </button>

          <div className="my-1 h-px bg-white/[0.08]" />
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-slate-500">
            行尾序列
          </p>
          {(['lf', 'crlf'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="menuitemradio"
              aria-checked={lineEnding === candidate}
              disabled={busy}
              onClick={() =>
                void run(() => onSetLineEnding(candidate))
              }
              className={itemClass}
            >
              <span>{candidate === 'lf' ? 'LF' : 'CRLF'}</span>
              <span className="text-indigo-200">
                {lineEnding === candidate ? '●' : '○'}
              </span>
            </button>
          ))}

          <div className="my-1 h-px bg-white/[0.08]" />
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-slate-500">
            使用编码打开
          </p>
          {(['utf-8', 'gbk'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="menuitemradio"
              aria-checked={encoding === candidate}
              disabled={busy || encodingDisabled}
              onClick={() =>
                void run(() => onSetEncoding(candidate), true)
              }
              className={itemClass}
            >
              <span>{candidate === 'utf-8' ? 'UTF-8' : 'GBK'}</span>
              <span className="text-indigo-200">
                {encoding === candidate ? '●' : '○'}
              </span>
            </button>
          ))}
          {encodingDisabled && (
            <p className="px-3 pt-1 pb-1.5 text-[10px] leading-4 text-amber-200/60">
              请先保存或放弃当前修改，再切换编码。
            </p>
          )}

          <div className="my-1 h-px bg-white/[0.08]" />
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void run(onReveal, true)}
            className={itemClass}
          >
            <span>在文件夹中显示</span>
          </button>
        </div>
      )}
    </div>
  );
}
