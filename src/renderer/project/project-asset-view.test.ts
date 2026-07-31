import { describe, expect, it } from 'vitest';

import {
  createProjectWorkspaceContentRef,
  type AssetCreationKind,
  type AssetSnapshot,
} from '../../shared/assets';
import {
  filterAssetLoadStateByCreationKind,
  filterAssetsByCreationKind,
  sortAssetsByLastUsed,
} from './project-asset-view';

function createAsset(
  id: string,
  creationKind: AssetCreationKind,
  updatedTime: number,
): AssetSnapshot {
  return {
    id,
    projectId: 'project',
    name: id,
    mediaType: 'text/plain',
    creationKind,
    contentRef: createProjectWorkspaceContentRef(
      `assets/${creationKind}/${id}.txt`,
    ),
    contentStatus: {
      availability: 'available',
      checkedTime: updatedTime,
    },
    createdTime: updatedTime,
    updatedTime,
  };
}

describe('Project Asset view model', () => {
  const assets = [
    createAsset('imported-old', 'imported', 100),
    createAsset('generated-old', 'generated', 200),
    createAsset('generated-new', 'generated', 300),
  ];

  it('groups Asset snapshots by their explicit creation kind', () => {
    expect(
      filterAssetsByCreationKind(assets, 'imported').map(
        (asset) => asset.id,
      ),
    ).toEqual(['imported-old']);
    expect(
      filterAssetLoadStateByCreationKind(
        { kind: 'ready', assets },
        'generated',
      ),
    ).toEqual({
      kind: 'ready',
      assets: [assets[1], assets[2]],
    });
  });

  it('sorts generated content by last used time without mutating input', () => {
    const generated = filterAssetsByCreationKind(
      assets,
      'generated',
    );

    expect(
      sortAssetsByLastUsed(generated).map((asset) => asset.id),
    ).toEqual(['generated-new', 'generated-old']);
    expect(generated.map((asset) => asset.id)).toEqual([
      'generated-old',
      'generated-new',
    ]);
  });

  it('preserves non-ready load states', () => {
    const loading = { kind: 'loading' } as const;

    expect(
      filterAssetLoadStateByCreationKind(loading, 'imported'),
    ).toBe(loading);
  });
});
