import { useMemo, type ReactNode } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import type {
  AssetPanelSelectionModel,
  AssetSelectionScope,
} from './asset-panel-selection';
import type { AssetListProps } from './AssetList';
import { AssetList } from './AssetList';
import { AssetSelectionCheckbox } from './AssetListItem';
import {
  sortAssetsByUpdatedTime,
  type AssetLoadState,
} from './project-asset-view';

type AssetPanelListProps = Omit<
  AssetListProps,
  | 'assets'
  | 'emptyState'
  | 'selectionMode'
  | 'selectedAssetIds'
  | 'onToggleSelection'
>;

export interface AssetPanelProps extends AssetPanelListProps {
  readonly id: string;
  readonly ariaLabel: string;
  readonly title: ReactNode;
  readonly state: AssetLoadState;
  readonly highlighted?: boolean;
  readonly countLabel?: (count: number) => ReactNode;
  readonly itemCount?: number;
  readonly toolbar?: ReactNode;
  readonly beforeList?: ReactNode;
  readonly beforeListClassName?: string;
  readonly listTitle: ReactNode;
  readonly listSummary?: ReactNode;
  readonly listAction?: ReactNode;
  readonly listBodyClassName?: string;
  readonly listLeadingContent?: ReactNode;
  readonly loadingLabel: string;
  readonly failedLabel: string;
  readonly emptyState: ReactNode;
  readonly onRetry?: () => void;
  readonly selection: AssetPanelSelectionModel;
  readonly onRemoveSelected: (
    scope: AssetSelectionScope,
    assets: readonly AssetSnapshot[],
  ) => void;
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

export function AssetPanel({
  id,
  ariaLabel,
  title,
  state,
  highlighted = false,
  countLabel = (count) => `${count} 项`,
  itemCount,
  toolbar,
  beforeList,
  beforeListClassName = '',
  listTitle,
  listSummary,
  listAction,
  listBodyClassName = 'px-2 pb-3',
  listLeadingContent,
  loadingLabel,
  failedLabel,
  emptyState,
  onRetry,
  selection,
  onRemoveSelected,
  selectedAssetId,
  busy,
  now,
  onSelect,
  onRename,
  onReveal,
  onRelink,
  onDelete,
}: AssetPanelProps) {
  const assets = useMemo(
    () =>
      state.kind === 'ready'
        ? sortAssetsByUpdatedTime(state.assets)
        : [],
    [state],
  );
  const summary = selection.active
    ? `已选 ${selection.selectedAssets.length} 项`
    : itemCount !== undefined
      ? countLabel(itemCount)
      : state.kind === 'ready'
        ? countLabel(assets.length)
        : '—';
  const canSelect = state.kind === 'ready' && assets.length > 0;
  const canToggleSelection = selection.active || canSelect;

  return (
    <aside
      id={id}
      aria-label={ariaLabel}
      data-asset-panel={id}
      className={[
        'flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[17px] border bg-[#20252c] shadow-[0_20px_50px_rgba(5,8,12,0.16)] transition-colors',
        highlighted
          ? 'border-indigo-300/45 bg-indigo-400/[0.08]'
          : 'border-white/[0.055]',
      ].join(' ')}
    >
      <div className="flex h-[54px] shrink-0 items-center justify-between border-b border-white/[0.075] px-[17px]">
        <h2 className="text-sm font-semibold text-slate-100">
          {title}
        </h2>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">
            {summary}
          </span>
          {canToggleSelection && (
            <button
              type="button"
              disabled={busy}
              onClick={
                selection.active
                  ? selection.exit
                  : selection.enter
              }
              className="ui-control rounded-md px-1.5 py-1 text-[10px] font-medium text-indigo-200 disabled:opacity-40"
            >
              {selection.active ? '完成' : '选择'}
            </button>
          )}
        </span>
      </div>

      {toolbar && <div className="shrink-0">{toolbar}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {beforeList && (
          <div className={beforeListClassName}>{beforeList}</div>
        )}

        {selection.active && (
          <div className="mx-[17px] mt-2.5 flex min-h-9 items-center justify-between gap-2 rounded-[10px] border border-white/[0.08] bg-black/10 px-2">
            <button
              type="button"
              aria-pressed={selection.allSelected}
              disabled={busy || assets.length === 0}
              onClick={selection.toggleAll}
              className="ui-control flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 disabled:opacity-40"
            >
              <AssetSelectionCheckbox
                checked={selection.allSelected}
              />
              {selection.allSelected ? '取消全选' : '全选'}
            </button>
            <span className="ml-auto text-[9px] text-slate-500">
              已选 {selection.selectedAssets.length} 项
            </span>
            <button
              type="button"
              disabled={
                busy || selection.selectedAssets.length === 0
              }
              onClick={() =>
                onRemoveSelected(
                  selection.scope,
                  selection.selectedAssets,
                )
              }
              className="ui-danger-button flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-medium text-rose-300 disabled:opacity-35"
            >
              <TrashIcon />
              移除
            </button>
          </div>
        )}

        <div className="flex items-center justify-between px-[17px] pt-2.5 pb-1 text-[10px] font-bold tracking-[0.09em] text-slate-500">
          <span>{listTitle}</span>
          <span className="flex items-center gap-1.5">
            {listSummary === undefined ? (
              <span className="text-[9px] font-medium tracking-normal text-slate-400/70">
                最近更新 ↓
              </span>
            ) : (
              listSummary
            )}
            {listAction}
          </span>
        </div>

        <div className={listBodyClassName}>
          {listLeadingContent}
          {state.kind === 'loading' && (
            <p className="px-3 py-8 text-center text-xs text-slate-500">
              {loadingLabel}
            </p>
          )}
          {state.kind === 'failed' && (
            <div className="px-3 py-8 text-center">
              <p className="text-xs text-rose-300">
                {failedLabel}
              </p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="ui-control mt-3 rounded-full border border-white/10 px-3 py-1.5 text-[10px]"
                >
                  重试
                </button>
              )}
            </div>
          )}
          {state.kind === 'ready' && (
            <AssetList
              assets={assets}
              selectedAssetId={selectedAssetId}
              selectionMode={selection.active}
              selectedAssetIds={selection.selectedAssetIds}
              busy={busy}
              now={now}
              emptyState={emptyState}
              onSelect={onSelect}
              onToggleSelection={selection.toggle}
              onRename={onRename}
              onReveal={onReveal}
              onRelink={onRelink}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
