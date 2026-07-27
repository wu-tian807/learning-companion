import { useEffect, useRef, useState } from 'react';

import type {
  PlainTextEncoding,
  PlainTextLineEnding,
  PlainTextViewOptions,
} from './shared';

interface PlainTextWorkbenchMenuProps {
  readonly disabled: boolean;
  readonly encodingDisabled: boolean;
  readonly encoding: PlainTextEncoding;
  readonly lineEnding: PlainTextLineEnding;
  readonly viewOptions: PlainTextViewOptions;
  readonly onSetEncoding: (encoding: PlainTextEncoding) => Promise<void>;
  readonly onSetLineEnding: (
    lineEnding: PlainTextLineEnding,
  ) => Promise<void>;
  readonly onSetViewOptions: (
    viewOptions: PlainTextViewOptions,
  ) => Promise<void>;
}

export function PlainTextWorkbenchMenu({
  disabled,
  encodingDisabled,
  encoding,
  lineEnding,
  viewOptions,
  onSetEncoding,
  onSetLineEnding,
  onSetViewOptions,
}: PlainTextWorkbenchMenuProps) {
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
    operation: () => Promise<void>,
    closeAfter = false,
  ) => {
    setBusy(true);
    try {
      await operation();
      if (closeAfter) {
        setOpen(false);
      }
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
        aria-label="纯文本工作台选项"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="ui-icon-button grid h-[26px] min-w-[32px] place-items-center rounded-lg border border-white/[0.08] px-2 text-xs tracking-[0.1em] text-slate-400 disabled:cursor-not-allowed disabled:opacity-35"
        title={disabled ? '当前暂时不能修改编辑器选项' : '编辑器选项'}
      >
        •••
      </button>

      {open && (
        <div
          role="menu"
          aria-label="纯文本编辑器选项"
          className="absolute top-8 right-0 z-40 w-56 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.48)]"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={viewOptions.wordWrap}
            disabled={busy}
            onClick={() =>
              void run(() =>
                onSetViewOptions({
                  ...viewOptions,
                  wordWrap: !viewOptions.wordWrap,
                }),
              )
            }
            className={itemClass}
          >
            <span>自动换行</span>
            <span className="text-indigo-200">
              {viewOptions.wordWrap ? '✓' : ''}
            </span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={viewOptions.lineNumbers}
            disabled={busy}
            onClick={() =>
              void run(() =>
                onSetViewOptions({
                  ...viewOptions,
                  lineNumbers: !viewOptions.lineNumbers,
                }),
              )
            }
            className={itemClass}
          >
            <span>显示行号</span>
            <span className="text-indigo-200">
              {viewOptions.lineNumbers ? '✓' : ''}
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
        </div>
      )}
    </div>
  );
}
