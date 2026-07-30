interface AppSetupGateProps {
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}

export function AppSetupGate({
  loading,
  error,
  onRetry,
}: AppSetupGateProps) {
  if (!loading && !error) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-[#10141b]/88 p-6 backdrop-blur-md">
      <section
        role={error ? 'alertdialog' : 'status'}
        aria-modal={error ? 'true' : undefined}
        className="w-full max-w-sm rounded-[20px] border border-white/[0.1] bg-[#252a32] p-6 text-center shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
      >
        {error ? (
          <>
            <div className="mx-auto grid size-10 place-items-center rounded-full bg-rose-300/10 text-lg font-semibold text-rose-200">
              !
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-100">
              无法读取应用设置
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {error}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="ui-primary-button mt-6 h-10 rounded-full bg-slate-50 px-5 text-sm font-semibold text-slate-900"
            >
              重试
            </button>
          </>
        ) : (
          <>
            <div
              aria-hidden="true"
              className="mx-auto size-8 animate-spin rounded-full border-2 border-indigo-200/20 border-t-indigo-200"
            />
            <p className="mt-4 text-sm text-slate-300">
              正在准备伴学伙伴…
            </p>
          </>
        )}
      </section>
    </div>
  );
}
