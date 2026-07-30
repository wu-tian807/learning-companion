import { useEffect, useRef } from 'react';

interface WorkspaceChangeConfirmDialogProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function WorkspaceChangeConfirmDialog({
  busy,
  error,
  onClose,
  onConfirm,
}: WorkspaceChangeConfirmDialogProps) {
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
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-6 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="workspace-change-title"
        aria-describedby="workspace-change-description"
        className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
      >
        <h2
          id="workspace-change-title"
          className="text-xl font-semibold text-slate-100"
        >
          更换 Project 工作区？
        </h2>
        <p
          id="workspace-change-description"
          className="mt-3 text-sm leading-6 text-slate-400"
        >
          更换工作区不会移动任何文件。使用相对路径的资料会改为从新目录读取，
          找不到的资料将被标记为失效；外部文件链接不受影响。
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
            className="ui-primary-button h-10 min-w-24 rounded-full bg-slate-50 px-5 text-sm font-semibold text-slate-900 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? '更换中…' : '确认更换'}
          </button>
        </div>
      </div>
    </div>
  );
}
