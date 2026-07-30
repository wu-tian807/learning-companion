import type { AppNotification } from './notification';

interface NotificationToastProps {
  readonly notification: AppNotification;
  readonly onDismiss: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onInvokeAction: () => void;
}

const kindStyles: Record<AppNotification['kind'], string> = {
  success:
    'border-emerald-300/20 bg-[#202b29] text-emerald-200',
  info: 'border-indigo-300/20 bg-[#252936] text-indigo-200',
  warning: 'border-amber-300/20 bg-[#2d2920] text-amber-200',
  error: 'border-rose-300/25 bg-[#302328] text-rose-200',
};

const kindMarks: Record<AppNotification['kind'], string> = {
  success: '✓',
  info: 'i',
  warning: '!',
  error: '!',
};

export function NotificationToast({
  notification,
  onDismiss,
  onPause,
  onResume,
  onInvokeAction,
}: NotificationToastProps) {
  const isError = notification.kind === 'error';

  return (
    <article
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`pointer-events-auto w-[min(380px,calc(100vw-32px))] rounded-2xl border px-4 py-3.5 shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl ${kindStyles[notification.kind]}`}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-current/10 text-xs font-semibold"
        >
          {kindMarks[notification.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-100">
            {notification.title}
          </h2>
          {notification.message && (
            <p className="mt-1 text-xs leading-5 text-slate-400">
              {notification.message}
            </p>
          )}
          {notification.action && (
            <button
              type="button"
              onClick={onInvokeAction}
              className="ui-control mt-2.5 h-8 rounded-full border border-white/[0.12] px-3 text-xs text-slate-200"
            >
              {notification.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="关闭通知"
          onClick={onDismiss}
          className="ui-icon-button -mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-slate-500"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="size-4"
            aria-hidden="true"
          >
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>
    </article>
  );
}
