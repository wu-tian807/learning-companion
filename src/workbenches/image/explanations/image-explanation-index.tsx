import type { ImageExplanationView } from './shared';

export function orderImageExplanations(
  explanations: readonly ImageExplanationView[],
): ImageExplanationView[] {
  return [...explanations].sort(
    (left, right) => left.createdTime - right.createdTime || left.id.localeCompare(right.id),
  );
}

export function summarizeImageExplanation(
  answer: string,
  maxCharacters = 40,
): string {
  const plainText = answer
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[#*_`>~]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const characters = Array.from(plainText);
  return characters.length > maxCharacters
    ? `${characters.slice(0, maxCharacters).join('')}…`
    : plainText;
}

function explanationStatusLabel(explanation: ImageExplanationView): string {
  if (explanation.status === 'completed') return '已完成';
  if (explanation.status === 'failed') return '生成失败';
  return '生成中';
}

function explanationStatusClassName(explanation: ImageExplanationView): string {
  if (explanation.status === 'completed') return 'bg-indigo-300/10 text-indigo-200';
  if (explanation.status === 'failed') return 'bg-rose-300/10 text-rose-200';
  return 'bg-slate-300/10 text-slate-300';
}

function regionSummary(explanation: ImageExplanationView): string {
  const region = explanation.target.anchorPayload;
  return `左侧 ${Math.round(region.x * 100)}% · 顶部 ${Math.round(region.y * 100)}% · ${Math.round(region.width * 100)}% × ${Math.round(region.height * 100)}%`;
}

export function ImageExplanationIndex({
  explanations,
  activeExplanationId,
  onActivate,
  onDelete,
  onClose,
}: {
  readonly explanations: readonly ImageExplanationView[];
  readonly activeExplanationId?: string;
  readonly onActivate: (explanation: ImageExplanationView) => void;
  readonly onDelete: (explanation: ImageExplanationView) => void;
  readonly onClose: () => void;
}) {
  const orderedExplanations = orderImageExplanations(explanations);

  return (
    <aside
      aria-label="图片标注索引"
      className="absolute inset-y-0 left-0 z-20 flex w-64 flex-col overflow-hidden border-r border-white/[0.08] bg-[#171c22]/97 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
        <div>
          <p className="text-[11px] font-semibold text-slate-300">标注索引</p>
          <p className="mt-0.5 text-[10px] text-slate-600">
            {explanations.length > 0
              ? `${explanations.length} 条·点击定位到图片区域`
              : '尚无标注'}
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭图片标注索引"
          onClick={onClose}
          className="ui-icon-button grid size-7 place-items-center rounded-md text-sm text-slate-500"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {explanations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.08] px-3 py-6 text-center">
            <p className="text-xs text-slate-500">还没有可定位的图片标注</p>
            <p className="mt-1.5 text-[10px] leading-4 text-slate-600">
              框选图片区域并生成 AI 解释后，标注会出现在这里。
            </p>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {orderedExplanations.map((explanation, index) => {
              const active = explanation.id === activeExplanationId;
              const number = index + 1;
              return (
                <li
                  key={explanation.id}
                  className={`group flex items-stretch rounded-lg border transition-colors ${
                    active
                      ? 'border-indigo-300/25 bg-indigo-300/[0.07]'
                      : 'border-transparent bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.04]'
                  }`}
                >
                  <button
                    type="button"
                    aria-current={active ? 'location' : undefined}
                    aria-label={`定位图片标注 ${number}`}
                    onClick={() => onActivate(explanation)}
                    className="min-w-0 flex-1 px-2.5 py-2 text-left"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium tabular-nums text-slate-500">
                        标注 {number}
                      </span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${explanationStatusClassName(explanation)}`}>
                        {explanationStatusLabel(explanation)}
                      </span>
                    </span>
                    <span className="mt-1.5 block truncate text-[10px] text-slate-500">
                      {regionSummary(explanation)}
                    </span>
                    {explanation.kind === 'attachment' && (
                      <span className="mt-1 block truncate text-[11px] leading-4 text-slate-300">
                        {summarizeImageExplanation(explanation.answer) || 'AI 图片解释'}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`删除图片标注 ${number}`}
                    title={explanation.status === 'pending' ? '取消生成' : '删除解释'}
                    onClick={() => onDelete(explanation)}
                    className="ui-icon-button my-2 mr-1 grid w-7 shrink-0 place-items-center rounded-md text-sm text-slate-600 opacity-70 hover:text-rose-300 group-hover:opacity-100 focus:opacity-100"
                  >
                    ×
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
