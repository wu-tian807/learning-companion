import {
  assetFolderName,
  assetFolderParentPath,
  isAssetFolderPathWithin,
  type AssetFolderSnapshot,
  type AssetFolderState,
} from '../../shared/asset-folders';
import type { AssetSnapshot } from '../../shared/assets';

export interface AssetFolderBreadcrumb {
  readonly label: string;
  readonly path: string | null;
}

export function listDirectAssetFolders(
  folders: readonly AssetFolderSnapshot[],
  parentPath: string | null,
): AssetFolderSnapshot[] {
  return folders
    .filter((folder) => assetFolderParentPath(folder.path) === parentPath)
    .sort((left, right) =>
      assetFolderName(left.path).localeCompare(assetFolderName(right.path), 'zh-CN', {
        sensitivity: 'base',
        numeric: true,
      }),
    );
}

export function filterAssetsInFolder(
  assets: readonly AssetSnapshot[],
  state: AssetFolderState,
  folderPath: string | null,
): AssetSnapshot[] {
  return assets.filter(
    (asset) => (state.folderPathByAssetId[asset.id] ?? null) === folderPath,
  );
}

export function createAssetFolderBreadcrumbs(
  folderPath: string | null,
): AssetFolderBreadcrumb[] {
  const breadcrumbs: AssetFolderBreadcrumb[] = [
    { label: '全部资料', path: null },
  ];
  if (folderPath === null) return breadcrumbs;

  const segments = folderPath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    breadcrumbs.push({
      label: segments[index]!,
      path: segments.slice(0, index + 1).join('/'),
    });
  }
  return breadcrumbs;
}

export function countAssetsInFolderTree(
  state: AssetFolderState,
  folderPath: string,
): number {
  return Object.values(state.folderPathByAssetId).filter((path) =>
    isAssetFolderPathWithin(path, folderPath),
  ).length;
}

export function listAssetFolderDestinations(
  folders: readonly AssetFolderSnapshot[],
  sourceFolderPath?: string,
): Array<{ readonly label: string; readonly path: string | null }> {
  return [
    { label: '全部资料（根目录）', path: null },
    ...folders
      .filter(
        (folder) =>
          !sourceFolderPath ||
          !isAssetFolderPathWithin(folder.path, sourceFolderPath),
      )
      .map((folder) => ({ label: folder.path, path: folder.path })),
  ];
}
