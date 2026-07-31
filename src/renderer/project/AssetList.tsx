import type { ReactNode } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import { AssetListItem } from './AssetListItem';

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
  onDelete,
}: AssetListProps) {
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
          <AssetListItem
            key={asset.id}
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
            onDelete={() => onDelete(asset)}
          />
        );
      })}
    </>
  );
}
