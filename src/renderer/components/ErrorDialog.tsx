import { useEffect, useRef } from 'react';

interface ErrorDialogProps {
  readonly message: string;
  readonly onClose: () => void;
}

export function ErrorDialog({ message, onClose }: ErrorDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-dialog-title"
        aria-describedby="error-dialog-description"
        className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-start gap-3.5">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full bg-rose-400/10 text-lg font-semibold text-rose-300"
            aria-hidden="true"
          >
            !
          </span>
          <div className="min-w-0 pt-0.5">
            <h2
              id="error-dialog-title"
              className="text-lg font-semibold text-slate-100"
            >
              操作未完成
            </h2>
            <p
              id="error-dialog-description"
              role="alert"
              className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-slate-400"
            >
              {message}
            </p>
          </div>
        </div>

        <div className="mt-7 flex justify-end">
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onClose}
            className="ui-primary-button h-10 min-w-24 rounded-full bg-slate-50 px-5 text-sm font-semibold text-slate-900"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
