import type { ReactNode } from 'react';

import { AssetSelectionCoordinatorContext } from './asset-selection-context';
import type { AssetSelectionCoordinator } from './use-asset-selection';

interface AssetSelectionCoordinatorProviderProps {
  readonly coordinator: AssetSelectionCoordinator;
  readonly children: ReactNode;
}

export function AssetSelectionCoordinatorProvider({
  coordinator,
  children,
}: AssetSelectionCoordinatorProviderProps) {
  return (
    <AssetSelectionCoordinatorContext.Provider value={coordinator}>
      {children}
    </AssetSelectionCoordinatorContext.Provider>
  );
}
