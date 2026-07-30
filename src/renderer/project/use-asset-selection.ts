import { useCallback, useMemo, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';

export interface AssetSelection {
  readonly active: boolean;
  readonly selectedAssetIds: ReadonlySet<string>;
  readonly selectedAssets: readonly AssetSnapshot[];
  readonly allSelected: boolean;
  readonly enter: () => void;
  readonly exit: () => void;
  readonly toggle: (assetId: string) => void;
  readonly toggleAll: () => void;
  readonly replace: (assetIds: readonly string[]) => void;
}

export function useAssetSelection(
  assets: readonly AssetSnapshot[],
): AssetSelection {
  const [active, setActive] = useState(false);
  const [storedAssetIds, setStoredAssetIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const availableAssetIds = useMemo(
    () => new Set(assets.map((asset) => asset.id)),
    [assets],
  );
  const selectedAssetIds = useMemo(
    () =>
      new Set(
        [...storedAssetIds].filter((assetId) =>
          availableAssetIds.has(assetId),
        ),
      ),
    [availableAssetIds, storedAssetIds],
  );
  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.has(asset.id)),
    [assets, selectedAssetIds],
  );
  const enter = useCallback(() => {
    setActive(true);
  }, []);
  const exit = useCallback(() => {
    setActive(false);
    setStoredAssetIds(new Set());
  }, []);
  const toggle = useCallback((assetId: string) => {
    setStoredAssetIds((current) => {
      const next = new Set(current);

      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }

      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setStoredAssetIds((current) => {
      const validSelectedCount = [...current].filter((assetId) =>
        availableAssetIds.has(assetId),
      ).length;

      return validSelectedCount === assets.length && assets.length > 0
        ? new Set()
        : new Set(assets.map((asset) => asset.id));
    });
  }, [assets, availableAssetIds]);
  const replace = useCallback((assetIds: readonly string[]) => {
    setStoredAssetIds(new Set(assetIds));
  }, []);

  return {
    active,
    selectedAssetIds,
    selectedAssets,
    allSelected:
      assets.length > 0 && selectedAssets.length === assets.length,
    enter,
    exit,
    toggle,
    toggleAll,
    replace,
  };
}
