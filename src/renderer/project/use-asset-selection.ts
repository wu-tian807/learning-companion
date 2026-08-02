import { useCallback, useMemo, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import type {
  AssetPanelSelectionModel,
  AssetSelectionScope,
} from './asset-panel-selection';

export type { AssetSelectionScope } from './asset-panel-selection';

export interface AssetSelectionState {
  readonly activeScope: AssetSelectionScope | null;
  readonly selectedAssetIds: ReadonlySet<string>;
}

export type AssetSelectionAction =
  | {
      readonly type: 'enter';
      readonly scope: AssetSelectionScope;
    }
  | {
      readonly type: 'exit';
      readonly scope: AssetSelectionScope;
    }
  | {
      readonly type: 'toggle';
      readonly scope: AssetSelectionScope;
      readonly assetId: string;
    }
  | {
      readonly type: 'toggle-all';
      readonly scope: AssetSelectionScope;
      readonly assetIds: readonly string[];
    }
  | {
      readonly type: 'replace';
      readonly scope: AssetSelectionScope;
      readonly assetIds: readonly string[];
    }
  | { readonly type: 'clear' };

export interface AssetSelection extends AssetPanelSelectionModel {
  readonly replace: (assetIds: readonly string[]) => void;
}

export interface AssetSelectionCoordinator {
  readonly activeScope: AssetSelectionScope | null;
  readonly imported: AssetSelection;
  readonly generated: AssetSelection;
  readonly clear: () => void;
}

export const EMPTY_ASSET_SELECTION_STATE: AssetSelectionState =
  Object.freeze({
    activeScope: null,
    selectedAssetIds: new Set<string>(),
  });

function normalizeAssetIds(assetIds: readonly string[]) {
  return new Set(
    assetIds.map((assetId) => assetId.trim()).filter(Boolean),
  );
}

export function reduceAssetSelection(
  state: AssetSelectionState,
  action: AssetSelectionAction,
): AssetSelectionState {
  if (action.type === 'clear') {
    return EMPTY_ASSET_SELECTION_STATE;
  }

  if (action.type === 'enter') {
    if (
      state.activeScope === action.scope &&
      state.selectedAssetIds.size === 0
    ) {
      return state;
    }

    return {
      activeScope: action.scope,
      selectedAssetIds: new Set(),
    };
  }

  if (state.activeScope !== action.scope) {
    return state;
  }

  if (action.type === 'exit') {
    return EMPTY_ASSET_SELECTION_STATE;
  }

  if (action.type === 'replace') {
    return {
      activeScope: action.scope,
      selectedAssetIds: normalizeAssetIds(action.assetIds),
    };
  }

  if (action.type === 'toggle-all') {
    const availableAssetIds = normalizeAssetIds(action.assetIds);
    const selectedAvailableCount = [...state.selectedAssetIds].filter(
      (assetId) => availableAssetIds.has(assetId),
    ).length;

    return {
      activeScope: action.scope,
      selectedAssetIds:
        availableAssetIds.size > 0 &&
        selectedAvailableCount === availableAssetIds.size
          ? new Set()
          : availableAssetIds,
    };
  }

  const assetId = action.assetId.trim();
  if (!assetId) {
    return state;
  }

  const selectedAssetIds = new Set(state.selectedAssetIds);
  if (selectedAssetIds.has(assetId)) {
    selectedAssetIds.delete(assetId);
  } else {
    selectedAssetIds.add(assetId);
  }

  return {
    activeScope: action.scope,
    selectedAssetIds,
  };
}

function createSelection(
  scope: AssetSelectionScope,
  assets: readonly AssetSnapshot[],
  state: AssetSelectionState,
  dispatch: (action: AssetSelectionAction) => void,
): AssetSelection {
  const active = state.activeScope === scope;
  const availableAssetIds = new Set(assets.map((asset) => asset.id));
  const selectedAssetIds = new Set(
    active
      ? [...state.selectedAssetIds].filter((assetId) =>
          availableAssetIds.has(assetId),
        )
      : [],
  );
  const selectedAssets = assets.filter((asset) =>
    selectedAssetIds.has(asset.id),
  );

  return {
    scope,
    active,
    selectedAssetIds,
    selectedAssets,
    allSelected:
      assets.length > 0 && selectedAssets.length === assets.length,
    enter: () => dispatch({ type: 'enter', scope }),
    exit: () => dispatch({ type: 'exit', scope }),
    toggle: (assetId) =>
      dispatch({ type: 'toggle', scope, assetId }),
    toggleAll: () =>
      dispatch({
        type: 'toggle-all',
        scope,
        assetIds: assets.map((asset) => asset.id),
      }),
    replace: (assetIds) =>
      dispatch({ type: 'replace', scope, assetIds }),
  };
}

export function useAssetSelectionCoordinator(
  importedAssets: readonly AssetSnapshot[],
  generatedAssets: readonly AssetSnapshot[],
): AssetSelectionCoordinator {
  const [state, setState] = useState<AssetSelectionState>(
    EMPTY_ASSET_SELECTION_STATE,
  );
  const dispatch = useCallback((action: AssetSelectionAction) => {
    setState((current) => reduceAssetSelection(current, action));
  }, []);
  const imported = useMemo(
    () =>
      createSelection('imported', importedAssets, state, dispatch),
    [dispatch, importedAssets, state],
  );
  const generated = useMemo(
    () =>
      createSelection('generated', generatedAssets, state, dispatch),
    [dispatch, generatedAssets, state],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), [dispatch]);

  return {
    activeScope: state.activeScope,
    imported,
    generated,
    clear,
  };
}
