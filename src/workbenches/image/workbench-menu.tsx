import { useEffect, useRef, useState } from 'react';

interface ImageWorkbenchMenuProps {
  readonly disabled: boolean;
  readonly onFit: () => void;
  readonly onActualSize: () => void;
  readonly onRotateClockwise: () => void;
  readonly onRotateCounterclockwise: () => void;
  readonly onReset: () => void;
  readonly onReveal: () => Promise<void> | void;
}

export function ImageWorkbenchMenu({
  disabled,
  onFit,
  onActualSize,
  onRotateClockwise,
  onRotateCounterclockwise,
  onReset,
  onReveal,
}: ImageWorkbenchMenuProps) {
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="图片工作台选项"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="ui-icon-button grid h-[26px] min-w-[32px] place-items-center rounded-lg border border-white/[0.08] px-2 text-xs tracking-[0.1em] text-slate-400 disabled:cursor-not-allowed disabled:opacity-35"
        title={disabled ? '图片尚未加载完成' : '图片查看选项'}
      >
        •••
      </button>

      {open && (
        <div
          role="menu"
          aria-label="图片查看选项"
          className="absolute top-8 right-0 z-40 w-56 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.48)]"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => run(onFit)}
            className={itemClass}
          >
            <span>适应窗口</span>
            <span className="text-slate-500">⌘/Ctrl + 0</span>
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
            <span className="text-slate-500">R</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => run(onRotateCounterclockwise)}
            className={itemClass}
          >
            <span>逆时针旋转</span>
            <span className="text-slate-500">⇧ R</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => run(onReset)}
            className={itemClass}
          >
            <span>重置视图</span>
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
