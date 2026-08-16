export interface DocumentMarkerVisibilityMenuProps {
  readonly open: boolean;
  readonly showQuestionAnchors: boolean;
  readonly showAttachments: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onShowQuestionAnchorsChange: (show: boolean) => void;
  readonly onShowAttachmentsChange: (show: boolean) => void;
}

export function DocumentMarkerVisibilityMenu({
  open,
  showQuestionAnchors,
  showAttachments,
  onOpenChange,
  onShowQuestionAnchorsChange,
  onShowAttachmentsChange,
}: DocumentMarkerVisibilityMenuProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="ui-icon-button grid size-[32px] place-items-center rounded-[10px] border border-white/10 text-slate-400 outline-none hover:border-amber-300/55 hover:text-amber-200"
        aria-label="选择文档标记显示内容"
        title="选择文档标记显示内容"
        aria-expanded={open}
      >
        <span aria-hidden="true">◉</span>
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-[100] w-44 rounded-xl border border-white/10 bg-[#202631] p-1.5 shadow-[0_16px_45px_rgba(0,0,0,.55)]">
          <button
            type="button"
            aria-pressed={showQuestionAnchors}
            onClick={() => onShowQuestionAnchorsChange(!showQuestionAnchors)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.06]"
          >
            <span>显示提问框选</span>
            <span aria-hidden="true">{showQuestionAnchors ? '✓' : '—'}</span>
          </button>
          <button
            type="button"
            aria-pressed={showAttachments}
            onClick={() => onShowAttachmentsChange(!showAttachments)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.06]"
          >
            <span>显示附着标注</span>
            <span aria-hidden="true">{showAttachments ? '✓' : '—'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
