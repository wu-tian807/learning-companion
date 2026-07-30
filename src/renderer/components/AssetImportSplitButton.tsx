import { useEffect, useRef, useState } from 'react';

interface AssetImportMenuProps {
  readonly onLink: () => void;
}

export function AssetImportMenu({ onLink }: AssetImportMenuProps) {
  return (
    <div
      role="menu"
      className="absolute top-[calc(100%+6px)] right-0 z-30 w-52 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.42)]"
    >
      <button
        type="button"
        role="menuitem"
        onClick={onLink}
        className="ui-menu-item block w-full rounded-lg px-3 py-2.5 text-left"
      >
        <span className="block text-xs font-medium text-slate-200">
          链接外部文件
        </span>
        <span className="mt-1 block text-[10px] leading-4 text-slate-500">
          不复制文件，移动原文件后可能失效
        </span>
      </button>
    </div>
  );
}

interface AssetImportSplitButtonProps {
  readonly disabled: boolean;
  readonly onCopy: () => void;
  readonly onLink: () => void;
}

function ChevronDownIcon() {
  return (
    <svg
      className="size-3"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function AssetImportSplitButton({
  disabled,
  onCopy,
  onLink,
}: AssetImportSplitButtonProps) {
  const [open, setOpen] = useState(false);
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
    if (!disabled) {
      return;
    }

    const frame = window.requestAnimationFrame(() => setOpen(false));
    return () => window.cancelAnimationFrame(frame);
  }, [disabled]);

  return (
    <div ref={rootRef} className="relative mx-3.5 mt-3.5 shrink-0">
      <div className="flex overflow-hidden rounded-[11px] border border-dashed border-indigo-200/20 bg-indigo-400/[0.045] text-xs font-medium text-indigo-100/85 transition-colors focus-within:border-indigo-200/40 hover:border-indigo-200/35 hover:bg-indigo-400/[0.09]">
        <button
          type="button"
          disabled={disabled}
          onClick={onCopy}
          className="flex min-w-0 flex-1 items-center justify-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.035] focus-visible:bg-white/[0.055] focus-visible:outline-none disabled:opacity-45"
        >
          <span aria-hidden="true">＋</span>
          添加资料
        </button>
        <button
          type="button"
          aria-label="更多添加方式"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          className="grid w-9 shrink-0 place-items-center border-l border-indigo-200/15 transition-colors hover:bg-white/[0.07] focus-visible:bg-white/[0.08] focus-visible:outline-none disabled:opacity-45"
        >
          <ChevronDownIcon />
        </button>
      </div>
      {open && (
        <AssetImportMenu
          onLink={() => {
            setOpen(false);
            onLink();
          }}
        />
      )}
    </div>
  );
}
