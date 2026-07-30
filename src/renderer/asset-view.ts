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
  return selectAfterAssetsDeletion(
    assets,
    [deletedAssetId],
    selectedAssetId,
  );
}

export function selectAfterAssetsDeletion(
  assets: readonly AssetSnapshot[],
  deletedAssetIds: readonly string[],
  selectedAssetId: string | null,
): string | null {
  const deleted = new Set(deletedAssetIds);

  if (!selectedAssetId || !deleted.has(selectedAssetId)) {
    return selectedAssetId;
  }

  const selectedIndex = assets.findIndex(
    (asset) => asset.id === selectedAssetId,
  );

  for (
    let index = selectedIndex + 1;
    index < assets.length;
    index += 1
  ) {
    const candidate = assets[index]!;

    if (!deleted.has(candidate.id)) {
      return candidate.id;
    }
  }

  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    const candidate = assets[index]!;

    if (!deleted.has(candidate.id)) {
      return candidate.id;
    }
  }

  return null;
}

export async function deleteAssetAfterWorkbenchClose(
  selectedAssetId: string | null,
  targetAssetId: string,
  workbenchClosed: Promise<void>,
  deselect: () => void,
  deleteAsset: () => Promise<void>,
): Promise<void> {
  return deleteAssetsAfterWorkbenchClose(
    selectedAssetId,
    [targetAssetId],
    workbenchClosed,
    deselect,
    deleteAsset,
  );
}

export async function deleteAssetsAfterWorkbenchClose(
  selectedAssetId: string | null,
  targetAssetIds: readonly string[],
  workbenchClosed: Promise<void>,
  deselect: () => void,
  deleteAssets: () => Promise<void>,
): Promise<void> {
  if (
    selectedAssetId &&
    new Set(targetAssetIds).has(selectedAssetId)
  ) {
    deselect();
    await workbenchClosed;
  }

  await deleteAssets();
}

export function replaceAsset(
  assets: readonly AssetSnapshot[],
  updatedAsset: AssetSnapshot,
): AssetSnapshot[] {
  return assets.map((asset) =>
    asset.id === updatedAsset.id ? updatedAsset : asset,
  );
}
