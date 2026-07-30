import type { AssetSnapshot } from '../../shared/assets';
import { AssetImportSplitButton } from '../components/AssetImportSplitButton';
import { AssetSourceBadge } from '../components/AssetSourceBadge';
import { AssetActionsMenu } from './AssetActionsMenu';
import {
  assetAvailabilityLabels,
  assetMediaLabel,
  formatAssetLastUsed,
  type AssetLoadState,
} from './project-asset-view';

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
  readonly busy: boolean;
  readonly refreshingAll: boolean;
  readonly dragging: boolean;
  readonly onSelect: (assetId: string) => void;
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
  busy,
  refreshingAll,
  dragging,
  onSelect,
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

  return (
    <aside
      aria-label="Project Assets"
      className={[
        'flex min-w-0 flex-col overflow-hidden rounded-[17px] border bg-[#20252c] shadow-[0_20px_50px_rgba(5,8,12,0.16)] transition-colors',
        dragging
          ? 'border-indigo-300/45 bg-indigo-400/[0.08]'
          : 'border-white/[0.055]',
      ].join(' ')}
    >
      <div className="flex h-[54px] shrink-0 items-center justify-between border-b border-white/[0.075] px-[17px]">
        <h2 className="text-sm font-semibold text-slate-100">Assets</h2>
        <span className="text-[11px] text-slate-500">
          {state.kind === 'ready' ? `${assets.length} 项` : '—'}
        </span>
      </div>

      <AssetImportSplitButton
        disabled={busy || state.kind !== 'ready'}
        onCopy={onCopyAdd}
        onLink={onLinkAdd}
      />

      <div className="flex shrink-0 items-center justify-between px-[17px] pt-2.5 pb-1 text-[10px] font-bold tracking-[0.09em] text-slate-500">
        <span>全部内容</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[9px] font-medium tracking-normal text-slate-400/70">
            最近使用 ↓
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
        {state.kind === 'ready' && assets.length === 0 && (
          <div className="px-3 py-10 text-center">
            <p className="text-xs font-medium text-slate-400">
              还没有资料
            </p>
            <p className="mt-2 text-[10px] leading-5 text-slate-600">
              点击添加资料，或将本地文件拖到这里
            </p>
          </div>
        )}
        {assets.map((asset) => (
          <div
            key={asset.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(asset.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(asset.id);
              }
            }}
            className={[
              'my-0.5 grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[11px] border p-2.5 text-left',
              asset.id === selectedAssetId
                ? 'border-indigo-300/15 bg-indigo-500/[0.12]'
                : 'border-transparent hover:bg-white/[0.035]',
            ].join(' ')}
          >
            <span className="grid size-[34px] place-items-center rounded-[9px] bg-white/[0.055] text-[10px] font-semibold text-slate-300">
              {assetMediaLabel(asset.mediaType).slice(0, 4)}
            </span>
            <span className="min-w-0">
              <span
                className={[
                  'block truncate text-xs font-medium',
                  asset.contentStatus.availability === 'available'
                    ? 'text-slate-200'
                    : 'text-red-400',
                ].join(' ')}
              >
                {asset.name}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-slate-500">
                <span className="truncate">
                  {assetMediaLabel(asset.mediaType)}
                </span>
                <AssetSourceBadge contentRef={asset.contentRef} />
                <span className="shrink-0 text-slate-600">·</span>
                <span className="truncate">
                  {formatAssetLastUsed(asset.lastUsedTime)}
                </span>
              </span>
            </span>
            <span className="flex items-center gap-1">
              {asset.contentStatus.availability !== 'available' && (
                <span
                  className="size-1.5 rounded-full bg-red-400"
                  title={
                    assetAvailabilityLabels[
                      asset.contentStatus.availability
                    ]
                  }
                  aria-label={
                    assetAvailabilityLabels[
                      asset.contentStatus.availability
                    ]
                  }
                />
              )}
              <AssetActionsMenu
                asset={asset}
                disabled={busy}
                onRename={() => onRename(asset)}
                onReveal={() => onReveal(asset)}
                onRelink={() => onRelink(asset)}
                onDelete={() => onDelete(asset)}
              />
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
