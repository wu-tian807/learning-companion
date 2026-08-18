export function ImageExplanationVisibilityToggle({
  visible,
  count,
  onToggle,
}: {
  readonly visible: boolean;
  readonly count: number;
  readonly onToggle: () => void;
}) {
  if (count <= 0) return null;

  const action = visible ? '隐藏标注' : '显示标注';
  return (
    <button
      type="button"
      aria-label={`${action}（${count}）`}
      aria-pressed={!visible}
      title={visible ? '隐藏图片上的区域边框和编号' : '重新显示图片上的区域边框和编号'}
      onClick={onToggle}
      className={`ui-control rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur ${
        visible
          ? 'border-white/[0.09] bg-[#20262e]/88 text-slate-400'
          : 'border-indigo-300/20 bg-indigo-400/10 text-indigo-200'
      }`}
    >
      {action}
      <span className="ml-1 tabular-nums opacity-60">{count}</span>
    </button>
  );
}
