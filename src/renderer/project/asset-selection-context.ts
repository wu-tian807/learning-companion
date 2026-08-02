import { createContext, useContext } from 'react';

import type { AssetSelectionScope } from './asset-panel-selection';
import type {
  AssetSelection,
  AssetSelectionCoordinator,
} from './use-asset-selection';

export const AssetSelectionCoordinatorContext =
  createContext<AssetSelectionCoordinator | null>(null);

export function useProjectAssetSelection(): AssetSelectionCoordinator {
  const coordinator = useContext(AssetSelectionCoordinatorContext);

  if (!coordinator) {
    throw new Error(
      'Asset 选择能力必须在 AssetSelectionCoordinatorProvider 内使用',
    );
  }

  return coordinator;
}

export function useAssetSelectionScope(
  scope: AssetSelectionScope,
): AssetSelection {
  return useProjectAssetSelection()[scope];
}
