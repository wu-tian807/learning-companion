import type { AssetSnapshot } from '../../shared/assets';

export type AssetSelectionScope = 'imported' | 'generated';

export interface AssetPanelSelectionModel {
  readonly scope: AssetSelectionScope;
  readonly active: boolean;
  readonly selectedAssetIds: ReadonlySet<string>;
  readonly selectedAssets: readonly AssetSnapshot[];
  readonly allSelected: boolean;
  readonly enter: () => void;
  readonly exit: () => void;
  readonly toggle: (assetId: string) => void;
  readonly toggleAll: () => void;
}
