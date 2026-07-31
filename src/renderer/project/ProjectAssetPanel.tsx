import type { AssetSnapshot } from '../../shared/assets';
import { AssetImportSplitButton } from '../components/AssetImportSplitButton';
import { AssetList } from './AssetList';
import { AssetSelectionCheckbox } from './AssetListItem';
import type { AssetLoadState } from './project-asset-view';

function RefreshIcon({ spinning = false }: { readonly spinning?: boolean }) {
  return (
    <svg
      className={['size-3.5', spinning ? 'animate-spin' : ''].join(' ')}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 7a6.5 6.5 0 1 0 .2 5.4" />
      <path d="M16 3v4h-4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 6.5h11M8 3.5h4l1 3H7l1-3Z" />
      <path d="m6 6.5.7 10h6.6l.7-10M8.5 9v4.5M11.5 9v4.5" />
    </svg>
  );
}

interface ProjectAssetPanelProps {
  readonly state: AssetLoadState;
  readonly selectedAssetId: string | null;
  readonly selectionMode: boolean;
  readonly selectedAssetIds: ReadonlySet<string>;
  readonly allAssetsSelected: boolean;
  readonly busy: boolean;
  readonly refreshingAll: boolean;
  readonly dragging: boolean;
  readonly now: number;
  readonly onSelect: (assetId: string) => void;
  readonly onEnterSelectionMode: () => void;
  readonly onExitSelectionMode: () => void;
  readonly onToggleSelection: (assetId: string) => void;
  readonly onToggleAll: () => void;
  readonly onDeleteSelected: () => void;
  readonly onCopyAdd: () => void;
  readonly onLinkAdd: () => void;
  readonly onRetry: () => void;
  readonly onRename: (asset: AssetSnapshot) => void;
  readonly onReveal: (asset: AssetSnapshot) => void;
  readonly onRelink: (asset: AssetSnapshot) => void;
  readonly onRefreshAll: () => void;
  readonly onDelete: (asset: AssetSnapshot) => void;
}

export function ProjectAssetPanel({
  state,
  selectedAssetId,
  selectionMode,
  selectedAssetIds,
  allAssetsSelected,
  busy,
  refreshingAll,
  dragging,
  now,
  onSelect,
  onEnterSelectionMode,
  onExitSelectionMode,
  onToggleSelection,
  onToggleAll,
  onDeleteSelected,
  onCopyAdd,
  onLinkAdd,
  onRetry,
  onRename,
  onReveal,
  onRelink,
  onRefreshAll,
  onDelete,
}: ProjectAssetPanelProps) {
  const assets = state.kind === 'ready' ? state.assets : [];
  const selectedCount = selectedAssetIds.size;

  return (
    <aside
      id="project-assets-panel"
      aria-label="Project Assets"
      className={[
        'flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[17px] border bg-[#20252c] shadow-[0_20px_50px_rgba(5,8,12,0.16)] transition-colors',
        dragging
          ? 'border-indigo-300/45 bg-indigo-400/[0.08]'
          : 'border-white/[0.055]',
      ].join(' ')}
    >
      <div className="flex h-[54px] shrink-0 items-center justify-between border-b border-white/[0.075] px-[17px]">
        <h2 className="text-sm font-semibold text-slate-100">
          {selectionMode ? '选择资料' : 'Assets'}
        </h2>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">
            {selectionMode
              ? `已选 ${selectedCount} 项`
              : state.kind === 'ready'
                ? `${assets.length} 项`
                : '—'}
          </span>
          {state.kind === 'ready' && assets.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={
                selectionMode
                  ? onExitSelectionMode
                  : onEnterSelectionMode
              }
              className="ui-control rounded-md px-1.5 py-1 text-[10px] font-medium text-indigo-200 disabled:opacity-40"
            >
              {selectionMode ? '完成' : '选择'}
            </button>
          )}
        </span>
      </div>

      {selectionMode ? (
        <div className="mx-3.5 mt-3.5 flex h-[39px] shrink-0 items-center justify-between rounded-[11px] border border-white/[0.08] bg-black/10 px-2">
          <button
            type="button"
            aria-pressed={allAssetsSelected}
            disabled={busy || assets.length === 0}
            onClick={onToggleAll}
            className="ui-control flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 disabled:opacity-40"
          >
            <AssetSelectionCheckbox checked={allAssetsSelected} />
            {allAssetsSelected ? '取消全选' : '全选'}
          </button>
          <button
            type="button"
            disabled={busy || selectedCount === 0}
            onClick={onDeleteSelected}
            className="ui-danger-button flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-rose-300 disabled:opacity-35"
          >
            <TrashIcon />
            移除
          </button>
        </div>
      ) : (
        <AssetImportSplitButton
          disabled={busy || state.kind !== 'ready'}
          onCopy={onCopyAdd}
          onLink={onLinkAdd}
        />
      )}

      <div className="flex shrink-0 items-center justify-between px-[17px] pt-2.5 pb-1 text-[10px] font-bold tracking-[0.09em] text-slate-500">
        <span>
          {selectionMode ? '选择要移除的资料' : '全部内容'}
        </span>
        {selectionMode ? (
          <span className="text-[9px] font-medium tracking-normal text-slate-500">
            {selectedCount}/{assets.length}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="text-[9px] font-medium tracking-normal text-slate-400/70">
              最近更新 ↓
            </span>
            <button
              type="button"
              aria-label="刷新全部资料状态"
              title="刷新全部资料状态"
              disabled={busy || state.kind !== 'ready'}
              onClick={onRefreshAll}
              className="ui-icon-button grid size-7 place-items-center rounded-lg text-slate-400 disabled:opacity-40"
            >
              <RefreshIcon spinning={refreshingAll} />
            </button>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {state.kind === 'loading' && (
          <p className="px-3 py-8 text-center text-xs text-slate-500">
            正在加载资料…
          </p>
        )}
        {state.kind === 'failed' && (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-rose-300">资料加载失败</p>
            <button
              type="button"
              onClick={onRetry}
              className="ui-control mt-3 rounded-full border border-white/10 px-3 py-1.5 text-[10px]"
            >
              重试
            </button>
          </div>
        )}
        {state.kind === 'ready' && (
          <AssetList
            assets={assets}
            selectedAssetId={selectedAssetId}
            selectionMode={selectionMode}
            selectedAssetIds={selectedAssetIds}
            busy={busy}
            now={now}
            emptyState={
              <div className="px-3 py-10 text-center">
                <p className="text-xs font-medium text-slate-400">
                  还没有资料
                </p>
                <p className="mt-2 text-[10px] leading-5 text-slate-600">
                  点击添加资料，或将本地文件拖到这里
                </p>
              </div>
            }
            onSelect={onSelect}
            onToggleSelection={onToggleSelection}
            onRename={onRename}
            onReveal={onReveal}
            onRelink={onRelink}
            onDelete={onDelete}
          />
        )}
      </div>
    </aside>
  );
}
