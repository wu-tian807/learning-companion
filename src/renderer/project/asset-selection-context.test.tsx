import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  useAssetSelectionScope,
  useProjectAssetSelection,
} from './asset-selection-context';
import { AssetSelectionCoordinatorProvider } from './AssetSelectionCoordinatorProvider';
import type {
  AssetSelection,
  AssetSelectionCoordinator,
} from './use-asset-selection';

function createSelection(
  scope: 'imported' | 'generated',
): AssetSelection {
  return {
    scope,
    active: scope === 'imported',
    selectedAssetIds: new Set(),
    selectedAssets: [],
    allSelected: false,
    enter: vi.fn(),
    exit: vi.fn(),
    toggle: vi.fn(),
    toggleAll: vi.fn(),
    replace: vi.fn(),
  };
}

function SelectionProbe() {
  const coordinator = useProjectAssetSelection();
  const imported = useAssetSelectionScope('imported');
  const generated = useAssetSelectionScope('generated');

  return (
    <p>
      {coordinator.activeScope}:{imported.scope}:{generated.scope}
    </p>
  );
}

describe('AssetSelectionCoordinatorProvider', () => {
  it('provides both selection scopes from one Project coordinator', () => {
    const coordinator: AssetSelectionCoordinator = {
      activeScope: 'imported',
      imported: createSelection('imported'),
      generated: createSelection('generated'),
      clear: vi.fn(),
    };

    expect(
      renderToStaticMarkup(
        <AssetSelectionCoordinatorProvider coordinator={coordinator}>
          <SelectionProbe />
        </AssetSelectionCoordinatorProvider>,
      ),
    ).toContain('imported:imported:generated');
  });

  it('fails fast outside a Project selection provider', () => {
    expect(() => renderToStaticMarkup(<SelectionProbe />)).toThrow(
      'Asset 选择能力必须在 AssetSelectionCoordinatorProvider 内使用',
    );
  });
});
