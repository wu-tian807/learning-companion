import { useEffect, useRef, useState } from 'react';

import type {
  PdfReadingMode,
  PdfSidebar,
} from './shared';

interface PdfWorkbenchMenuProps {
  readonly disabled: boolean;
  readonly readingMode: PdfReadingMode;
  readonly sidebar: PdfSidebar;
  readonly hasOutline: boolean;
  readonly onReadingMode: (mode: PdfReadingMode) => void;
  readonly onSidebar: (sidebar: PdfSidebar) => void;
  readonly onPageWidth: () => void;
  readonly onPageFit: () => void;
  readonly onActualSize: () => void;
  readonly onRotateClockwise: () => void;
  readonly onRotateCounterclockwise: () => void;
  readonly onReveal: () => Promise<void> | void;
}

export function PdfWorkbenchMenu({
  disabled,
  readingMode,
  sidebar,
  hasOutline,
  onReadingMode,
  onSidebar,
  onPageWidth,
  onPageFit,
  onActualSize,
  onRotateClockwise,
  onRotateCounterclockwise,
  onReveal,
}: PdfWorkbenchMenuProps) {
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

  const run = (operation: () => Promise<void> | void) => {
    setBusy(true);
    void Promise.resolve(operation()).finally(() => {
      setBusy(false);
      setOpen(false);
    });
  };
  const itemClass =
    'ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-35';
  const check = (selected: boolean) => (
    <span
      className={selected ? 'text-indigo-300' : 'text-transparent'}
      aria-hidden="true"
    >
      ✓
    </span>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="PDF 工作台选项"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="ui-icon-button grid h-[26px] min-w-[32px] place-items-center rounded-lg border border-white/[0.08] px-2 text-xs tracking-[0.1em] text-slate-400 disabled:cursor-not-allowed disabled:opacity-35"
        title={disabled ? 'PDF 尚未加载完成' : 'PDF 阅读选项'}
      >
        •••
      </button>

      {open && (
        <div
          role="menu"
          aria-label="PDF 阅读选项"
          className="absolute top-8 right-0 z-50 w-60 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.48)]"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={readingMode === 'continuous'}
            disabled={busy}
            onClick={() => run(() => onReadingMode('continuous'))}
            className={itemClass}
          >
            <span>连续滚动</span>
            {check(readingMode === 'continuous')}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={readingMode === 'paged'}
            disabled={busy}
            onClick={() => run(() => onReadingMode('paged'))}
            className={itemClass}
          >
            <span>单页翻页</span>
            {check(readingMode === 'paged')}
          </button>

          <div className="my-1 h-px bg-white/[0.08]" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={sidebar === 'thumbnails'}
            disabled={busy}
            onClick={() =>
              run(() =>
                onSidebar(
                  sidebar === 'thumbnails' ? 'closed' : 'thumbnails',
                ),
              )
            }
            className={itemClass}
          >
            <span>显示缩略图</span>
            {check(sidebar === 'thumbnails')}
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={sidebar === 'outline'}
            disabled={busy || !hasOutline}
            onClick={() =>
              run(() =>
                onSidebar(
                  sidebar === 'outline' ? 'closed' : 'outline',
                ),
              )
            }
            className={itemClass}
          >
            <span>{hasOutline ? '显示文档目录' : '文档没有目录'}</span>
            {check(sidebar === 'outline')}
          </button>

          <div className="my-1 h-px bg-white/[0.08]" />
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => run(onPageWidth)}
            className={itemClass}
          >
            <span>适应宽度</span>
            <span className="text-slate-500">⌘/Ctrl + 0</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => run(onPageFit)}
            className={itemClass}
          >
            <span>适应整页</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => run(onActualSize)}
            className={itemClass}
          >
            <span>实际大小</span>
            <span className="text-slate-500">⌘/Ctrl + 1</span>
          </button>

          <div className="my-1 h-px bg-white/[0.08]" />
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => run(onRotateClockwise)}
            className={itemClass}
          >
            <span>顺时针旋转</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => run(onRotateCounterclockwise)}
            className={itemClass}
          >
            <span>逆时针旋转</span>
          </button>

          <div className="my-1 h-px bg-white/[0.08]" />
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => run(onReveal)}
            className={itemClass}
          >
            <span>在文件夹中显示</span>
          </button>
        </div>
      )}
    </div>
  );
}
