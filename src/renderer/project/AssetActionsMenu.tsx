import { useEffect, useRef, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';

interface AssetActionsMenuProps {
  readonly asset: AssetSnapshot;
  readonly disabled: boolean;
  readonly onRename: () => void;
  readonly onReveal: () => void;
  readonly onRelink: () => void;
  readonly onMove?: () => void;
  readonly onDelete: () => void;
}

export function AssetActionsMenu({
  asset,
  disabled,
  onRename,
  onReveal,
  onRelink,
  onMove,
  onDelete,
}: AssetActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const run = (operation: () => void) => {
    setOpen(false);
    operation();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`${asset.name} 的更多操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className="ui-icon-button grid size-7 place-items-center rounded-lg text-xs tracking-widest text-slate-500 disabled:opacity-40"
      >
        •••
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-8 right-0 z-30 w-36 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 text-xs shadow-[0_18px_45px_rgba(0,0,0,0.42)]"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onRename)}
            className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left"
          >
            编辑标题
          </button>
          {asset.contentRef.kind === 'local-file' &&
            asset.contentStatus.availability === 'available' && (
              <button
                type="button"
                role="menuitem"
                onClick={() => run(onReveal)}
                className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left"
              >
                在文件夹中显示
              </button>
            )}
          {asset.contentRef.kind === 'local-file' &&
            (asset.contentStatus.availability === 'missing' ||
              asset.contentStatus.availability === 'invalid') && (
              <button
                type="button"
                role="menuitem"
                onClick={() => run(onRelink)}
                className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left"
              >
                重新定位
              </button>
            )}
          {onMove && (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onMove)}
              className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left"
            >
              移动到…
            </button>
          )}
          <div className="my-1 h-px bg-white/[0.08]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onDelete)}
            className="ui-menu-item ui-menu-item-danger block w-full rounded-lg px-3 py-2 text-left text-rose-300"
          >
            从 Project 中移除
          </button>
        </div>
      )}
    </div>
  );
}
