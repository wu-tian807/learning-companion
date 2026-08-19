import { ImageExplanationVisibilityToggle } from './image-explanation-visibility-toggle';

export function ImageExplanationHeaderActions({
  explanationCount,
  indexOpen,
  markersVisible,
  canStartSelection,
  canToggleIndex,
  onStartSelection,
  onToggleIndex,
  onToggleMarkers,
}: {
  readonly explanationCount: number;
  readonly indexOpen: boolean;
  readonly markersVisible: boolean;
  readonly canStartSelection: boolean;
  readonly canToggleIndex: boolean;
  readonly onStartSelection: () => void;
  readonly onToggleIndex: () => void;
  readonly onToggleMarkers: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={!canStartSelection}
        onClick={onStartSelection}
        className="ui-control h-8 rounded-lg border border-indigo-300/15 px-2.5 text-xs text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
        title={canStartSelection ? '框选一个区域，AI 会结合整张图片进行解释' : '请先完成当前图片操作'}
      >
        框选解释
      </button>
      <button
        type="button"
        aria-label={`切换图片标注索引（${explanationCount}）`}
        aria-expanded={indexOpen}
        disabled={!canToggleIndex}
        onClick={onToggleIndex}
        className={`ui-control h-8 rounded-lg border px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
          indexOpen
            ? 'border-indigo-300/25 bg-indigo-400/10 text-indigo-200'
            : 'border-white/[0.09] text-slate-300'
        }`}
      >
        标注
        <span className="ml-1 tabular-nums opacity-60">{explanationCount}</span>
      </button>
      <ImageExplanationVisibilityToggle
        visible={markersVisible}
        count={explanationCount}
        onToggle={onToggleMarkers}
      />
    </div>
  );
}
