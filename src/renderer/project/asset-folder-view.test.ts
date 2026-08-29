import { describe, expect, it } from 'vitest';

import type { AssetFolderState } from '../../shared/asset-folders';
import type { AssetSnapshot } from '../../shared/assets';
import {
  countAssetsInFolderTree,
  createAssetFolderBreadcrumbs,
  filterAssetsInFolder,
  listAssetFolderDestinations,
  listDirectAssetFolders,
} from './asset-folder-view';

const state: AssetFolderState = {
  projectId: 'project',
  folders: [
    { projectId: 'project', path: '课程' },
    { projectId: 'project', path: '课程/第 10 章' },
    { projectId: 'project', path: '课程/第 2 章' },
    { projectId: 'project', path: '归档' },
  ],
  folderPathByAssetId: {
    chapter: '课程/第 2 章',
    course: '课程',
  },
};

const assets = [
  { id: 'root' },
  { id: 'chapter' },
  { id: 'course' },
] as AssetSnapshot[];

describe('asset folder view helpers', () => {
  it('lists only direct children using OS-like natural ordering', () => {
    expect(
      listDirectAssetFolders(state.folders, '课程').map(({ path }) => path),
    ).toEqual(['课程/第 2 章', '课程/第 10 章']);
  });

  it('shows only directly contained Assets', () => {
    expect(filterAssetsInFolder(assets, state, null).map(({ id }) => id)).toEqual([
      'root',
    ]);
    expect(
      filterAssetsInFolder(assets, state, '课程').map(({ id }) => id),
    ).toEqual(['course']);
  });

  it('derives breadcrumbs and recursive deletion counts from path segments', () => {
    expect(createAssetFolderBreadcrumbs('课程/第 2 章')).toEqual([
      { label: '全部资料', path: null },
      { label: '课程', path: '课程' },
      { label: '第 2 章', path: '课程/第 2 章' },
    ]);
    expect(countAssetsInFolderTree(state, '课程')).toBe(2);
  });

  it('removes a moved folder and every descendant from destinations', () => {
    expect(
      listAssetFolderDestinations(state.folders, '课程').map(({ path }) => path),
    ).toEqual([null, '归档']);
  });
});
