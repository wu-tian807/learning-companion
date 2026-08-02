import type { AssetSnapshot } from '../../shared/assets';
import { AssetImportSplitButton } from '../components/AssetImportSplitButton';
import type {
  AssetPanelSelectionModel,
  AssetSelectionScope,
} from './asset-panel-selection';
import { AssetPanel } from './AssetPanel';
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

interface ProjectAssetPanelProps {
  readonly state: AssetLoadState;
  readonly selectedAssetId: string | null;
  readonly selection: AssetPanelSelectionModel;
  readonly busy: boolean;
  readonly refreshingAll: boolean;
  readonly dragging: boolean;
  readonly now: number;
  readonly onSelect: (assetId: string) => void;
  readonly onRemoveSelected: (
    scope: AssetSelectionScope,
    assets: readonly AssetSnapshot[],
  ) => void;
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
  selection,
  busy,
  refreshingAll,
  dragging,
  now,
  onSelect,
  onRemoveSelected,
  onCopyAdd,
  onLinkAdd,
  onRetry,
  onRename,
  onReveal,
  onRelink,
  onRefreshAll,
  onDelete,
}: ProjectAssetPanelProps) {
  return (
    <AssetPanel
      id="project-assets-panel"
      ariaLabel="Project Assets"
      title="Assets"
      state={state}
      highlighted={dragging}
      toolbar={
        <AssetImportSplitButton
          disabled={busy || state.kind !== 'ready'}
          onCopy={onCopyAdd}
          onLink={onLinkAdd}
        />
      }
      listTitle="全部内容"
      listAction={
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
      }
      loadingLabel="正在加载资料…"
      failedLabel="资料加载失败"
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
      selection={selection}
      onRemoveSelected={onRemoveSelected}
      selectedAssetId={selectedAssetId}
      busy={busy}
      now={now}
      onRetry={onRetry}
      onSelect={onSelect}
      onRename={onRename}
      onReveal={onReveal}
      onRelink={onRelink}
      onDelete={onDelete}
    />
  );
}
