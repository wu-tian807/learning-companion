export function ImageRegionSelectionActions({
  busy,
  onExplain,
  onAsk,
  onReselect,
  onCancel,
}: {
  readonly busy: boolean;
  readonly onExplain: () => void;
  readonly onAsk: () => void;
  readonly onReselect: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/[0.1] bg-[#20262e]/94 p-2 shadow-xl backdrop-blur">
      <span className="px-2 text-xs text-slate-300">已选中兴趣区域</span>
      <button type="button" disabled={busy} onClick={onExplain} className="ui-control rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-100 disabled:cursor-not-allowed disabled:opacity-40">AI 解释</button>
      <button type="button" disabled={busy} onClick={onAsk} className="ui-control rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-100 disabled:cursor-not-allowed disabled:opacity-40">自由提问</button>
      <button type="button" onClick={onReselect} className="ui-control rounded-lg px-2 py-1.5 text-xs text-slate-400">重选</button>
      <button type="button" onClick={onCancel} className="ui-control rounded-lg px-2 py-1.5 text-xs text-slate-500">取消</button>
    </div>
  );
}
