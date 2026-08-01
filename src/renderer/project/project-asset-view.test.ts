import { describe, expect, it } from 'vitest';

import {
  createProjectWorkspaceContentRef,
  type AssetCreationKind,
  type AssetSnapshot,
} from '../../shared/assets';
import {
  applyAssetChangedEvent,
  assetMediaLabel,
  filterAssetLoadStateByCreationKind,
  filterAssetsByCreationKind,
  sortAssetsByUpdatedTime,
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

  it('shows a concise label for Mind Map assets', () => {
    expect(
      assetMediaLabel(
        'application/vnd.learning-companion.mindmap+json',
      ),
    ).toBe('Mind Map');
  });

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

  it('sorts generated content by updated time without mutating input', () => {
    const generated = filterAssetsByCreationKind(
      assets,
      'generated',
    );

    expect(
      sortAssetsByUpdatedTime(generated).map((asset) => asset.id),
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

  it('applies only events for loaded Assets in the current Project', () => {
    const state = { kind: 'ready', assets } as const;
    const updated = createAsset('generated-old', 'generated', 400);

    expect(
      applyAssetChangedEvent(state, 'project', {
        projectId: 'project',
        asset: updated,
      }),
    ).toEqual({
      kind: 'ready',
      assets: [assets[0], updated, assets[2]],
    });
    expect(
      applyAssetChangedEvent(state, 'project', {
        projectId: 'another-project',
        asset: { ...updated, projectId: 'another-project' },
      }),
    ).toBe(state);
    expect(
      applyAssetChangedEvent(state, 'project', {
        projectId: 'project',
        asset: createAsset('not-loaded', 'imported', 500),
      }),
    ).toBe(state);
  });
});
