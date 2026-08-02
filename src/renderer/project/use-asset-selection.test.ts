import { describe, expect, it } from 'vitest';

import {
  EMPTY_ASSET_SELECTION_STATE,
  reduceAssetSelection,
  type AssetSelectionState,
} from './use-asset-selection';

function selectedIds(state: AssetSelectionState) {
  return [...state.selectedAssetIds];
}

describe('reduceAssetSelection', () => {
  it('atomically switches scope and clears the previous selection', () => {
    const imported = reduceAssetSelection(
      EMPTY_ASSET_SELECTION_STATE,
      { type: 'enter', scope: 'imported' },
    );
    const selected = reduceAssetSelection(imported, {
      type: 'toggle',
      scope: 'imported',
      assetId: 'source',
    });
    const generated = reduceAssetSelection(selected, {
      type: 'enter',
      scope: 'generated',
    });

    expect(generated.activeScope).toBe('generated');
    expect(selectedIds(generated)).toEqual([]);
  });

  it('ignores stale actions from an inactive scope', () => {
    const generated = reduceAssetSelection(
      EMPTY_ASSET_SELECTION_STATE,
      { type: 'enter', scope: 'generated' },
    );

    expect(
      reduceAssetSelection(generated, {
        type: 'replace',
        scope: 'imported',
        assetIds: ['source'],
      }),
    ).toBe(generated);
    expect(
      reduceAssetSelection(generated, {
        type: 'exit',
        scope: 'imported',
      }),
    ).toBe(generated);
  });

  it('supports toggle, toggle all, replace and clear', () => {
    const entered = reduceAssetSelection(
      EMPTY_ASSET_SELECTION_STATE,
      { type: 'enter', scope: 'imported' },
    );
    const toggled = reduceAssetSelection(entered, {
      type: 'toggle',
      scope: 'imported',
      assetId: 'one',
    });
    const all = reduceAssetSelection(toggled, {
      type: 'toggle-all',
      scope: 'imported',
      assetIds: ['one', 'two'],
    });
    const none = reduceAssetSelection(all, {
      type: 'toggle-all',
      scope: 'imported',
      assetIds: ['one', 'two'],
    });
    const replaced = reduceAssetSelection(none, {
      type: 'replace',
      scope: 'imported',
      assetIds: ['two', 'two', ''],
    });

    expect(selectedIds(toggled)).toEqual(['one']);
    expect(selectedIds(all)).toEqual(['one', 'two']);
    expect(selectedIds(none)).toEqual([]);
    expect(selectedIds(replaced)).toEqual(['two']);
    expect(
      reduceAssetSelection(replaced, { type: 'clear' }),
    ).toBe(EMPTY_ASSET_SELECTION_STATE);
  });
});
