import type { AssetSnapshot } from '../shared/assets';

export function selectInitialAssetId(
  assets: readonly AssetSnapshot[],
): string | null {
  if (assets.length === 0) {
    return null;
  }

  const byRecentUse = [...assets].sort(
    (left, right) => right.lastUsedTime - left.lastUsedTime,
  );

  return (
    byRecentUse.find(
      (asset) => asset.contentStatus.availability === 'available',
    ) ?? byRecentUse[0]
  ).id;
}

export function selectAfterAssetDeletion(
  assets: readonly AssetSnapshot[],
  deletedAssetId: string,
  selectedAssetId: string | null,
): string | null {
  if (selectedAssetId !== deletedAssetId) {
    return selectedAssetId;
  }

  const deletedIndex = assets.findIndex((asset) => asset.id === deletedAssetId);
  const remaining = assets.filter((asset) => asset.id !== deletedAssetId);

  if (remaining.length === 0) {
    return null;
  }

  return remaining[Math.min(deletedIndex, remaining.length - 1)]!.id;
}

export function replaceAsset(
  assets: readonly AssetSnapshot[],
  updatedAsset: AssetSnapshot,
): AssetSnapshot[] {
  return assets.map((asset) =>
    asset.id === updatedAsset.id ? updatedAsset : asset,
  );
}
