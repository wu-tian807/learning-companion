import type {
  AssetContentRef,
  AssetSnapshot,
} from '../shared/assets';

export function assetSourceBadgeLabel(
  contentRef: AssetContentRef,
): string | undefined {
  return contentRef.kind === 'local-file' &&
    contentRef.base === 'absolute'
    ? '外部'
    : undefined;
}

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

export async function deleteAssetAfterWorkbenchClose(
  selectedAssetId: string | null,
  targetAssetId: string,
  workbenchClosed: Promise<void>,
  deselect: () => void,
  deleteAsset: () => Promise<void>,
): Promise<void> {
  if (selectedAssetId === targetAssetId) {
    deselect();
    await workbenchClosed;
  }

  await deleteAsset();
}

export function replaceAsset(
  assets: readonly AssetSnapshot[],
  updatedAsset: AssetSnapshot,
): AssetSnapshot[] {
  return assets.map((asset) =>
    asset.id === updatedAsset.id ? updatedAsset : asset,
  );
}
