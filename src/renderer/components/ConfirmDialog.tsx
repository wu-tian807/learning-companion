import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  projectName: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  projectName,
  busy,
  error,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onClose();
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
      >
        <h2 id="delete-dialog-title" className="text-xl font-semibold text-slate-100">
          删除 Project？
        </h2>
        <p id="delete-dialog-description" className="mt-3 text-sm leading-6 text-slate-400">
          “{projectName}”及其 Asset 记录将从应用中删除，本地原文件不会被删除。
        </p>

        {error && (
          <p role="alert" className="mt-3 text-xs text-rose-300">
            {error}
          </p>
        )}

        <div className="mt-7 flex justify-end gap-2.5">
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={busy}
            onClick={onClose}
            className="ui-control h-10 rounded-full border border-white/[0.12] px-4 text-sm text-slate-300 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="ui-danger-button h-10 min-w-24 rounded-full bg-rose-500 px-5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
