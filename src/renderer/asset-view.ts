import type { AssetSummary } from '../shared/ipc';

export function selectInitialAssetId(
  assets: readonly AssetSummary[],
): string | null {
  if (assets.length === 0) {
    return null;
  }

  const byRecentUse = [...assets].sort(
    (left, right) =>
      Date.parse(right.lastUsedTime) - Date.parse(left.lastUsedTime),
  );

  return (
    byRecentUse.find(
      (asset) => asset.contentLocator.availability === 'available',
    ) ?? byRecentUse[0]
  ).id;
}

export function selectAfterAssetDeletion(
  assets: readonly AssetSummary[],
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
  assets: readonly AssetSummary[],
  updatedAsset: AssetSummary,
): AssetSummary[] {
  return assets.map((asset) =>
    asset.id === updatedAsset.id ? updatedAsset : asset,
  );
}
