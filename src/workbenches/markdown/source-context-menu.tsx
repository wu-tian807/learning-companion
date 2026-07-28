import { useEffect, useRef } from 'react';

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
