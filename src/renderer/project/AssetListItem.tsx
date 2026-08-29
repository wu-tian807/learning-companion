import type { AssetSnapshot } from '../../shared/assets';
import { AssetSourceBadge } from '../components/AssetSourceBadge';
import { AssetActionsMenu } from './AssetActionsMenu';
import {
  assetAvailabilityLabels,
  assetMediaLabel,
} from './project-asset-view';
import { formatRelativeTime } from './relative-time';

export function AssetSelectionCheckbox({
  checked,
}: {
  readonly checked: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={[
        'grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors',
        checked
          ? 'border-indigo-300/70 bg-indigo-400 text-slate-950'
          : 'border-white/20 bg-black/10 text-transparent',
      ].join(' ')}
    >
      <svg
        className="size-3"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m3.5 8 3 3 6-6" />
      </svg>
    </span>
  );
}

export interface AssetListItemProps {
  readonly asset: AssetSnapshot;
  readonly selected: boolean;
  readonly selectionMode: boolean;
  readonly checked: boolean;
  readonly busy: boolean;
  readonly now: number;
  readonly onActivate: () => void;
  readonly onRename: () => void;
  readonly onReveal: () => void;
  readonly onRelink: () => void;
  readonly onMove?: () => void;
  readonly onDelete: () => void;
}

export function AssetListItem({
  asset,
  selected,
  selectionMode,
  checked,
  busy,
  now,
  onActivate,
  onRename,
  onReveal,
  onRelink,
  onMove,
  onDelete,
}: AssetListItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selectionMode ? checked : undefined}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
      className={[
        'my-0.5 grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[11px] border p-2.5 text-left',
        selectionMode
          ? checked
            ? 'border-indigo-300/25 bg-indigo-500/[0.16]'
            : 'border-transparent hover:bg-white/[0.035]'
          : selected
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
            {formatRelativeTime(asset.updatedTime, now)}
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
        {selectionMode ? (
          <AssetSelectionCheckbox checked={checked} />
        ) : (
          <AssetActionsMenu
            asset={asset}
            disabled={busy}
            onRename={onRename}
            onReveal={onReveal}
            onRelink={onRelink}
            onMove={onMove}
            onDelete={onDelete}
          />
        )}
      </span>
    </div>
  );
}
