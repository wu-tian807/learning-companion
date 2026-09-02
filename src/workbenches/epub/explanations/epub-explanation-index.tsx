import type { EpubExplanationView } from './shared';

function explanationStatusLabel(
  explanation: EpubExplanationView,
): string {
  if (explanation.status === 'completed') return '已完成';
  if (explanation.status === 'failed') return '生成失败';
  return '生成中';
}

function explanationStatusClassName(
  explanation: EpubExplanationView,
): string {
  if (explanation.status === 'completed') {
    return 'bg-sky-300/10 text-sky-200';
  }
  if (explanation.status === 'failed') {
    return 'bg-rose-300/10 text-rose-200';
  }
  return 'bg-slate-300/10 text-slate-300';
}

export function EpubExplanationIndex({
  explanations,
  activeExplanationId,
  onActivate,
  onClose,
}: {
  readonly explanations: readonly EpubExplanationView[];
  readonly activeExplanationId?: string;
  readonly onActivate: (explanation: EpubExplanationView) => void;
  readonly onClose: () => void;
}) {
  return (
    <aside
      aria-label="EPUB 标注索引"
      className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-white/[0.07] bg-[#171c22]"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
        <div>
          <p className="text-[11px] font-semibold text-slate-300">标注索引</p>
          <p className="mt-0.5 text-[10px] text-slate-600">
            {explanations.length > 0
              ? `${explanations.length} 条·点击定位到原文`
              : '尚无标注'}
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭 EPUB 标注索引"
          onClick={onClose}
          className="ui-icon-button grid size-7 place-items-center rounded-md text-sm text-slate-500"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {explanations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.08] px-3 py-6 text-center">
            <p className="text-xs text-slate-500">还没有可定位的标注</p>
            <p className="mt-1.5 text-[10px] leading-4 text-slate-600">
              选中一段文字并使用“解释这段话”后，标注会出现在这里。
            </p>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {explanations.map((explanation, index) => {
              const active = explanation.id === activeExplanationId;
              const quote = explanation.target.targetPayload.quote.exact;

              return (
                <li key={explanation.id}>
                  <button
                    type="button"
                    aria-current={active ? 'location' : undefined}
                    title={quote}
                    onClick={() => onActivate(explanation)}
                    className={`ui-menu-item w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      active
                        ? 'border-sky-300/25 bg-sky-300/[0.07]'
                        : 'border-transparent bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium tabular-nums text-slate-500">
                        标注 {index + 1}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${explanationStatusClassName(explanation)}`}
                      >
                        {explanationStatusLabel(explanation)}
                      </span>
                    </span>
                    <span className="mt-1.5 line-clamp-3 block break-words text-[11px] leading-5 text-slate-300">
                      “{quote}”
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </aside>
  );
}
