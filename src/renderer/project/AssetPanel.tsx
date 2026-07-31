import { useMemo, type ReactNode } from 'react';

import type { AssetListProps } from './AssetList';
import { AssetList } from './AssetList';
import {
  sortAssetsByUpdatedTime,
  type AssetLoadState,
} from './project-asset-view';

type AssetPanelListProps = Omit<
  AssetListProps,
  'assets' | 'emptyState'
>;

export interface AssetPanelProps extends AssetPanelListProps {
  readonly id: string;
  readonly ariaLabel: string;
  readonly title: ReactNode;
  readonly state: AssetLoadState;
  readonly highlighted?: boolean;
  readonly countLabel?: (count: number) => ReactNode;
  readonly headerSummary?: ReactNode;
  readonly headerAction?: ReactNode;
  readonly toolbar?: ReactNode;
  readonly beforeList?: ReactNode;
  readonly beforeListClassName?: string;
  readonly listTitle: ReactNode;
  readonly listSummary?: ReactNode;
  readonly listAction?: ReactNode;
  readonly listBodyClassName?: string;
  readonly loadingLabel: string;
  readonly failedLabel: string;
  readonly emptyState: ReactNode;
  readonly onRetry?: () => void;
}

export function AssetPanel({
  id,
  ariaLabel,
  title,
  state,
  highlighted = false,
  countLabel = (count) => `${count} 项`,
  headerSummary,
  headerAction,
  toolbar,
  beforeList,
  beforeListClassName = '',
  listTitle,
  listSummary,
  listAction,
  listBodyClassName = 'px-2 pb-3',
  loadingLabel,
  failedLabel,
  emptyState,
  onRetry,
  selectedAssetId,
  selectionMode = false,
  selectedAssetIds,
  busy,
  now,
  onSelect,
  onToggleSelection,
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
  const summary =
    headerSummary === undefined
      ? state.kind === 'ready'
        ? countLabel(assets.length)
        : '—'
      : headerSummary;

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
          {headerAction}
        </span>
      </div>

      {toolbar && <div className="shrink-0">{toolbar}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {beforeList && (
          <div className={beforeListClassName}>{beforeList}</div>
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
              selectionMode={selectionMode}
              selectedAssetIds={selectedAssetIds}
              busy={busy}
              now={now}
              emptyState={emptyState}
              onSelect={onSelect}
              onToggleSelection={onToggleSelection}
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
