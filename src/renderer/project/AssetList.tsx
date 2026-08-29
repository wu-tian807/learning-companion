import type { ReactNode } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import { AssetListItem } from './AssetListItem';
import { useAssetOrderAnimation } from './use-asset-order-animation';

export interface AssetListProps {
  readonly assets: readonly AssetSnapshot[];
  readonly selectedAssetId: string | null;
  readonly selectionMode?: boolean;
  readonly selectedAssetIds?: ReadonlySet<string>;
  readonly busy: boolean;
  readonly now: number;
  readonly emptyState?: ReactNode;
  readonly onSelect: (assetId: string) => void;
  readonly onToggleSelection?: (assetId: string) => void;
  readonly onRename: (asset: AssetSnapshot) => void;
  readonly onReveal: (asset: AssetSnapshot) => void;
  readonly onRelink: (asset: AssetSnapshot) => void;
  readonly onMove?: (asset: AssetSnapshot) => void;
  readonly onDelete: (asset: AssetSnapshot) => void;
}

export function AssetList({
  assets,
  selectedAssetId,
  selectionMode = false,
  selectedAssetIds = new Set(),
  busy,
  now,
  emptyState,
  onSelect,
  onToggleSelection,
  onRename,
  onReveal,
  onRelink,
  onMove,
  onDelete,
}: AssetListProps) {
  const rowsRef = useAssetOrderAnimation(assets);

  if (assets.length === 0) {
    return emptyState ?? null;
  }

  return (
    <>
      {assets.map((asset) => {
        const checked = selectedAssetIds.has(asset.id);
        const activate = () => {
          if (selectionMode) {
            onToggleSelection?.(asset.id);
          } else {
            onSelect(asset.id);
          }
        };

        return (
          <div
            key={asset.id}
            ref={(row) => {
              if (row) {
                rowsRef.current.set(asset.id, row);
              } else {
                rowsRef.current.delete(asset.id);
              }
            }}
            data-asset-list-row={asset.id}
          >
            <AssetListItem
              asset={asset}
              selected={asset.id === selectedAssetId}
              selectionMode={selectionMode}
              checked={checked}
              busy={busy}
              now={now}
              onActivate={activate}
              onRename={() => onRename(asset)}
              onReveal={() => onReveal(asset)}
              onRelink={() => onRelink(asset)}
              onMove={onMove ? () => onMove(asset) : undefined}
              onDelete={() => onDelete(asset)}
            />
          </div>
        );
      })}
    </>
  );
}
