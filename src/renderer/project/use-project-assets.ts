import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import {
  isAssetSnapshot,
  isAssetSnapshotList,
  type AssetSnapshot,
  type LocalAssetImportMode,
} from '../../shared/assets';
import {
  isAddLocalAssetsResult,
  isDeleteAssetsResult,
  type AddLocalAssetsResult,
  type DeleteAssetsResult,
} from '../../shared/ipc';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  deleteAssetsAfterWorkbenchClose,
  replaceAsset,
  selectAfterAssetsDeletion,
} from '../asset-view';
import {
  applyAssetChangedEvent,
  filterAssetsByCreationKind,
  type AssetLoadState,
} from './project-asset-view';
import { useAssetSelection } from './use-asset-selection';

interface UseProjectAssetsOptions {
  readonly projectId: string;
  readonly loadState: AssetLoadState;
  readonly setLoadState: Dispatch<SetStateAction<AssetLoadState>>;
  readonly selectedAssetId: string | null;
  readonly selectAsset: (assetId: string | null) => void;
  readonly workbenchLifecycleTaskRef:
    MutableRefObject<Promise<void>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
}

export function useProjectAssets({
  projectId,
  loadState,
  setLoadState,
  selectedAssetId,
  selectAsset,
  workbenchLifecycleTaskRef,
  setError,
}: UseProjectAssetsOptions) {
  const [busy, setBusy] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [renameTarget, setRenameTarget] =
    useState<AssetSnapshot | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<
    readonly AssetSnapshot[] | null
  >(null);
  const mutationLockRef = useRef(false);
  const assets = useMemo(
    () => (loadState.kind === 'ready' ? loadState.assets : []),
    [loadState],
  );
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId),
    [assets, selectedAssetId],
  );
  const importedAssets = useMemo(
    () => filterAssetsByCreationKind(assets, 'imported'),
    [assets],
  );
  const selection = useAssetSelection(importedAssets);
  const updateAssets = useCallback(
    (operation: (assets: AssetSnapshot[]) => AssetSnapshot[]) => {
      setLoadState((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', assets: operation(current.assets) }
          : current,
      );
    },
    [setLoadState],
  );

  useEffect(
    () =>
      window.learningCompanion.onAssetChanged((event) => {
        setLoadState((current) =>
          applyAssetChangedEvent(current, projectId, event),
        );
      }),
    [projectId, setLoadState],
  );
  const runMutation = useCallback(
    async (operation: () => Promise<void>, message: string) => {
      if (mutationLockRef.current) {
        return false;
      }

      mutationLockRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await operation();
        return true;
      } catch (mutationError) {
        const userMessage = userMessageFromError(mutationError, message);
        if (userMessage) {
          console.error(userMessage, mutationError);
          setError(userMessage);
        }
        return false;
      } finally {
        mutationLockRef.current = false;
        setBusy(false);
      }
    },
    [setError],
  );
  const importPaths = useCallback(
    async (paths: string[], mode: LocalAssetImportMode) => {
      const result: AddLocalAssetsResult =
        await window.learningCompanion.addLocalAssets({
          projectId,
          paths,
          mode,
        });

      if (!isAddLocalAssetsResult(result)) {
        throw new Error('批量添加 Asset 响应无效');
      }

      setLoadState({ kind: 'ready', assets: result.assets });

      if (result.added[0]) {
        selectAsset(result.added[0].id);
      }
      if (result.failed.length > 0) {
        setError(
          `已添加 ${result.added.length} 项，${result.failed.length} 项失败：${result.failed[0]!.message}`,
        );
      }
    },
    [projectId, selectAsset, setError, setLoadState],
  );
  const addPaths = useCallback(
    async (
      paths: string[],
      mode: LocalAssetImportMode = 'copy',
    ) => {
      if (paths.length === 0) {
        return;
      }

      await runMutation(
        () => importPaths(paths, mode),
        '添加资料失败，请重试。',
      );
    },
    [importPaths, runMutation],
  );

  const chooseAndAdd = async (mode: LocalAssetImportMode) => {
    await runMutation(async () => {
      const paths =
        await window.learningCompanion.selectLocalAssetFiles({
          projectId,
        });

      if (paths.length > 0) {
        await importPaths(paths, mode);
      }
    }, '添加资料失败，请重试。');
  };

  const renameAsset = async (name: string) => {
    if (!renameTarget) {
      return;
    }

    const succeeded = await runMutation(async () => {
      const updated = await window.learningCompanion.renameAsset({
        assetId: renameTarget.id,
        name,
      });
      if (!isAssetSnapshot(updated)) {
        throw new Error('Asset 重命名响应无效');
      }
      updateAssets((current) => replaceAsset(current, updated));
    }, '无法保存 Asset 标题。');

    if (succeeded) {
      setRenameTarget(null);
    }
  };

  const relinkAsset = async (asset: AssetSnapshot) => {
    const [path] = await window.learningCompanion.selectLocalAssetFiles({
      projectId,
    });
    if (!path) {
      return;
    }

    await runMutation(async () => {
      const updated = await window.learningCompanion.relinkAsset({
        assetId: asset.id,
        path,
      });
      if (!isAssetSnapshot(updated)) {
        throw new Error('Asset Relink 响应无效');
      }
      updateAssets((current) => replaceAsset(current, updated));
    }, '无法重新定位该 Asset。');
  };

  const revealAssetInFolder = async (asset: AssetSnapshot) => {
    await runMutation(
      () =>
        window.learningCompanion.revealAssetInFolder({
          assetId: asset.id,
        }),
      '无法在文件夹中显示该 Asset。',
    );
  };

  const refreshAsset = async (asset: AssetSnapshot) => {
    await runMutation(async () => {
      const updated = await window.learningCompanion.refreshAsset({
        assetId: asset.id,
      });
      if (!isAssetSnapshot(updated)) {
        throw new Error('Asset 刷新响应无效');
      }
      updateAssets((current) => replaceAsset(current, updated));
    }, '无法刷新文件状态。');
  };

  const refreshAllAssets = async () => {
    setRefreshingAll(true);
    try {
      await runMutation(async () => {
        const refreshed =
          await window.learningCompanion.refreshAllAssets({
            projectId,
          });
        if (!isAssetSnapshotList(refreshed)) {
          throw new Error('Asset 批量刷新响应无效');
        }
        setLoadState({ kind: 'ready', assets: refreshed });
      }, '无法刷新全部文件状态。');
    } finally {
      setRefreshingAll(false);
    }
  };

  const deleteAssets = async () => {
    if (!deleteTargets || deleteTargets.length === 0) {
      return;
    }

    const targets = deleteTargets;
    const targetIds = targets.map((asset) => asset.id);
    const selectedBeforeDeletion = selectedAssetId;
    const activeWorkbenchClosed =
      workbenchLifecycleTaskRef.current;
    let receivedResult = false;
    const succeeded = await runMutation(async () => {
      let result: DeleteAssetsResult | undefined;

      await deleteAssetsAfterWorkbenchClose(
        selectedBeforeDeletion,
        targetIds,
        activeWorkbenchClosed,
        () => selectAsset(null),
        async () => {
          result = await window.learningCompanion.deleteAssets({
            projectId,
            assetIds: targetIds,
          });
        },
      );

      if (!isDeleteAssetsResult(result)) {
        throw new Error('批量删除 Asset 响应无效');
      }

      receivedResult = true;
      setLoadState({ kind: 'ready', assets: result.assets });
      selectAsset(
        selectAfterAssetsDeletion(
          assets,
          result.deletedAssetIds,
          selectedBeforeDeletion,
        ),
      );

      if (result.failed.length === 0) {
        setDeleteTargets(null);
        selection.exit();
        return;
      }

      const failedIds = new Set(
        result.failed.map((failure) => failure.assetId),
      );
      const retryTargets = result.assets.filter((asset) =>
        failedIds.has(asset.id),
      );
      const firstFailure = result.failed[0]!;
      setError(
        `已移除 ${result.deletedAssetIds.length} 项，${result.failed.length} 项失败：${firstFailure.message}`,
      );
      selection.replace(retryTargets.map((asset) => asset.id));
      setDeleteTargets(
        retryTargets.length > 0 ? retryTargets : null,
      );
    }, '无法移除所选 Asset。');

    if (
      !succeeded &&
      !receivedResult &&
      selectedBeforeDeletion &&
      targetIds.includes(selectedBeforeDeletion)
    ) {
      selectAsset(selectedBeforeDeletion);
    }
  };

  return {
    assets,
    selectedAsset,
    busy,
    refreshingAll,
    renameTarget,
    setRenameTarget,
    deleteTargets,
    setDeleteTargets,
    selection,
    addPaths,
    chooseAndAdd,
    renameAsset,
    relinkAsset,
    revealAssetInFolder,
    refreshAsset,
    refreshAllAssets,
    deleteAssets,
  };
}
