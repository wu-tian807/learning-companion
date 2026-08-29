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
  assetFolderName,
  assetFolderParentPath,
  isAssetFolderPathWithin,
  isAssetFolderState,
  joinAssetFolderPath,
  rebaseAssetFolderPath,
  type AssetFolderSnapshot,
  type AssetFolderState,
} from '../../shared/asset-folders';
import {
  isAssetSnapshot,
  isAssetSnapshotList,
  type AssetSnapshot,
  type LocalAssetImportMode,
} from '../../shared/assets';
import {
  isAddLocalAssetsResult,
  isDeleteAssetFolderResult,
  isDeleteAssetsResult,
  type AddLocalAssetsResult,
  type DeleteAssetFolderResult,
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
import { filterAssetsInFolder } from './asset-folder-view';
import {
  useAssetSelectionCoordinator,
  type AssetSelectionScope,
} from './use-asset-selection';

interface AssetDeleteRequest {
  readonly assets: readonly AssetSnapshot[];
  readonly selectionScope: AssetSelectionScope | null;
}

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
  const [deleteRequest, setDeleteRequest] =
    useState<AssetDeleteRequest | null>(null);
  const [folderState, setFolderState] =
    useState<AssetFolderState | null>(null);
  const [folderLoadFailureProjectId, setFolderLoadFailureProjectId] =
    useState<string | null>(null);
  const [folderLocation, setFolderLocation] = useState<{
    readonly projectId: string;
    readonly path: string | null;
  }>({ projectId, path: null });
  const activeFolderState =
    folderState?.projectId === projectId ? folderState : null;
  const folderLoadFailed = folderLoadFailureProjectId === projectId;
  const currentFolderPath =
    folderLocation.projectId === projectId ? folderLocation.path : null;
  const mutationLockRef = useRef(false);
  const folderRequestVersionRef = useRef(0);
  const assets = useMemo(
    () => (loadState.kind === 'ready' ? loadState.assets : []),
    [loadState],
  );
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId),
    [assets, selectedAssetId],
  );
  const allImportedAssets = useMemo(
    () => filterAssetsByCreationKind(assets, 'imported'),
    [assets],
  );
  const importedAssets = useMemo(
    () =>
      activeFolderState
        ? filterAssetsInFolder(
            allImportedAssets,
            activeFolderState,
            currentFolderPath,
          )
        : [],
    [activeFolderState, allImportedAssets, currentFolderPath],
  );
  const generatedAssets = useMemo(
    () => filterAssetsByCreationKind(assets, 'generated'),
    [assets],
  );
  const selection = useAssetSelectionCoordinator(
    importedAssets,
    generatedAssets,
  );
  const clearSelection = selection.clear;
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
  useEffect(() => {
    clearSelection();
  }, [clearSelection, projectId]);
  const loadAssetFolders = useCallback(async () => {
    const requestVersion = folderRequestVersionRef.current + 1;
    folderRequestVersionRef.current = requestVersion;
    try {
      const nextState = await window.learningCompanion.listAssetFolders({
        projectId,
      });
      if (!isAssetFolderState(nextState) || nextState.projectId !== projectId) {
        throw new Error('Asset Folder 响应无效');
      }
      if (folderRequestVersionRef.current !== requestVersion) return;
      setFolderState(nextState);
      setFolderLoadFailureProjectId(null);
    } catch (folderError) {
      if (folderRequestVersionRef.current !== requestVersion) return;
      const message = userMessageFromError(
        folderError,
        '无法读取资料文件夹。',
      );
      if (message) {
        console.error(message, folderError);
        setError(message);
      }
      setFolderLoadFailureProjectId(projectId);
    }
  }, [projectId, setError]);
  useEffect(() => {
    if (loadState.kind === 'ready') {
      void Promise.resolve().then(loadAssetFolders);
    }
    return () => {
      folderRequestVersionRef.current += 1;
    };
  }, [loadAssetFolders, loadState.kind]);
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
  const applyFolderState = useCallback(
    (nextState: AssetFolderState) => {
      if (
        !isAssetFolderState(nextState) ||
        nextState.projectId !== projectId
      ) {
        throw new Error('Asset Folder 响应无效');
      }
      setFolderState(nextState);
    },
    [projectId],
  );
  const openFolder = useCallback(
    (path: string | null) => {
      if (
        path !== null &&
        !activeFolderState?.folders.some((folder) => folder.path === path)
      ) {
        return;
      }
      clearSelection();
      setFolderLocation({ projectId, path });
    },
    [activeFolderState, clearSelection, projectId],
  );
  const createFolder = useCallback(
    (name: string) =>
      runMutation(async () => {
        const nextState = await window.learningCompanion.createAssetFolder({
          projectId,
          path: joinAssetFolderPath(currentFolderPath, name),
        });
        applyFolderState(nextState);
      }, '无法创建资料文件夹。'),
    [applyFolderState, currentFolderPath, projectId, runMutation],
  );
  const renameFolder = useCallback(
    (folder: AssetFolderSnapshot, name: string) =>
      runMutation(async () => {
        const nextPath = joinAssetFolderPath(
          assetFolderParentPath(folder.path),
          name,
        );
        const nextState = await window.learningCompanion.updateAssetFolder({
          projectId,
          path: folder.path,
          nextPath,
        });
        applyFolderState(nextState);
        setFolderLocation((current) => ({
          projectId,
          path:
            current.projectId === projectId &&
            current.path &&
            isAssetFolderPathWithin(current.path, folder.path)
              ? rebaseAssetFolderPath(current.path, folder.path, nextPath)
              : current.projectId === projectId
                ? current.path
                : null,
        }));
      }, '无法重命名资料文件夹。'),
    [applyFolderState, projectId, runMutation],
  );
  const moveFolder = useCallback(
    (folder: AssetFolderSnapshot, parentPath: string | null) =>
      runMutation(async () => {
        const nextPath = joinAssetFolderPath(
          parentPath,
          assetFolderName(folder.path),
        );
        const nextState = await window.learningCompanion.updateAssetFolder({
          projectId,
          path: folder.path,
          nextPath,
        });
        applyFolderState(nextState);
        setFolderLocation((current) => ({
          projectId,
          path:
            current.projectId === projectId &&
            current.path &&
            isAssetFolderPathWithin(current.path, folder.path)
              ? rebaseAssetFolderPath(current.path, folder.path, nextPath)
              : current.projectId === projectId
                ? current.path
                : null,
        }));
      }, '无法移动资料文件夹。'),
    [applyFolderState, projectId, runMutation],
  );
  const moveAssets = useCallback(
    (targets: readonly AssetSnapshot[], folderPath: string | null) =>
      runMutation(async () => {
        if (targets.length === 0) return;
        const nextState = await window.learningCompanion.moveAssetsToFolder({
          projectId,
          assetIds: targets.map((asset) => asset.id),
          folderPath,
        });
        applyFolderState(nextState);
        selection.imported.exit();
      }, '无法移动所选资料。'),
    [applyFolderState, projectId, runMutation, selection.imported],
  );
  const importPaths = useCallback(
    async (paths: string[], mode: LocalAssetImportMode) => {
      const result: AddLocalAssetsResult =
        await window.learningCompanion.addLocalAssets({
          projectId,
          paths,
          mode,
          ...(currentFolderPath ? { folderPath: currentFolderPath } : {}),
        });

      if (!isAddLocalAssetsResult(result)) {
        throw new Error('批量添加 Asset 响应无效');
      }

      setLoadState({ kind: 'ready', assets: result.assets });
      if (currentFolderPath) {
        setFolderState((current) =>
          current?.projectId === projectId
            ? {
                ...current,
                folderPathByAssetId: {
                  ...current.folderPathByAssetId,
                  ...Object.fromEntries(
                    result.added.map((asset) => [
                      asset.id,
                      currentFolderPath,
                    ]),
                  ),
                },
              }
            : current,
        );
      }

      if (result.added[0]) {
        selectAsset(result.added[0].id);
      }
      if (result.failed.length > 0) {
        setError(
          `已添加 ${result.added.length} 项，${result.failed.length} 项失败：${result.failed[0]!.message}`,
        );
      }
    },
    [currentFolderPath, projectId, selectAsset, setError, setLoadState],
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

  const requestDelete = useCallback(
    (
      scope: AssetSelectionScope | null,
      targets: readonly AssetSnapshot[],
    ) => {
      if (targets.length === 0 || mutationLockRef.current) {
        return;
      }

      setDeleteRequest({
        assets: [...targets],
        selectionScope: scope,
      });
    },
    [],
  );
  const cancelDelete = useCallback(() => {
    if (!mutationLockRef.current) {
      setDeleteRequest(null);
    }
  }, []);

  const deleteAssets = async () => {
    if (!deleteRequest || deleteRequest.assets.length === 0) {
      return;
    }

    const request = deleteRequest;
    const targets = request.assets;
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
      const deletedAssetIds = result.deletedAssetIds;

      receivedResult = true;
      setLoadState({ kind: 'ready', assets: result.assets });
      setFolderState((current) => {
        if (!current || current.projectId !== projectId) return current;
        const folderPathByAssetId = { ...current.folderPathByAssetId };
        for (const assetId of deletedAssetIds) {
          delete folderPathByAssetId[assetId];
        }
        return { ...current, folderPathByAssetId };
      });
      selectAsset(
        selectAfterAssetsDeletion(
          assets,
          result.deletedAssetIds,
          selectedBeforeDeletion,
        ),
      );

      if (result.failed.length === 0) {
        setDeleteRequest(null);
        if (request.selectionScope) {
          selection[request.selectionScope].exit();
        }
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
      if (request.selectionScope) {
        selection[request.selectionScope].replace(
          retryTargets.map((asset) => asset.id),
        );
      }
      setDeleteRequest(
        retryTargets.length > 0
          ? {
              assets: retryTargets,
              selectionScope: request.selectionScope,
            }
          : null,
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

  const deleteFolder = async (folder: AssetFolderSnapshot) => {
    if (!activeFolderState) return false;
    const targetIds = assets
      .filter((asset) => {
        const path = activeFolderState.folderPathByAssetId[asset.id];
        return path ? isAssetFolderPathWithin(path, folder.path) : false;
      })
      .map((asset) => asset.id);
    const selectedBeforeDeletion = selectedAssetId;
    let receivedResult = false;
    let folderDeleted = false;
    const succeeded = await runMutation(async () => {
      let result: DeleteAssetFolderResult | undefined;

      await deleteAssetsAfterWorkbenchClose(
        selectedBeforeDeletion,
        targetIds,
        workbenchLifecycleTaskRef.current,
        () => selectAsset(null),
        async () => {
          result = await window.learningCompanion.deleteAssetFolder({
            projectId,
            path: folder.path,
          });
        },
      );

      if (!isDeleteAssetFolderResult(result)) {
        throw new Error('删除 Asset Folder 响应无效');
      }

      receivedResult = true;
      setLoadState({ kind: 'ready', assets: result.assets });
      applyFolderState(result.folderState);
      clearSelection();
      selectAsset(
        selectAfterAssetsDeletion(
          assets,
          result.deletedAssetIds,
          selectedBeforeDeletion,
        ),
      );
      folderDeleted = !result.folderState.folders.some(
        (candidate) => candidate.path === folder.path,
      );
      if (
        folderDeleted &&
        currentFolderPath &&
        isAssetFolderPathWithin(currentFolderPath, folder.path)
      ) {
        setFolderLocation({
          projectId,
          path: assetFolderParentPath(folder.path),
        });
      }
      if (result.failed.length > 0) {
        setError(
          `已移除 ${result.deletedAssetIds.length} 项，${result.failed.length} 项失败：${result.failed[0]!.message}`,
        );
      }
    }, '无法删除资料文件夹。');

    if (
      !succeeded &&
      !receivedResult &&
      selectedBeforeDeletion &&
      targetIds.includes(selectedBeforeDeletion)
    ) {
      selectAsset(selectedBeforeDeletion);
    }
    return succeeded && folderDeleted;
  };

  const importedAssetState: AssetLoadState =
    loadState.kind !== 'ready'
      ? loadState
      : folderLoadFailed
        ? { kind: 'failed' }
        : activeFolderState
          ? { kind: 'ready', assets: importedAssets }
          : { kind: 'loading' };

  return {
    assets,
    selectedAsset,
    busy,
    refreshingAll,
    renameTarget,
    setRenameTarget,
    deleteTargets: deleteRequest?.assets ?? null,
    selectionCoordinator: selection,
    folderState: activeFolderState,
    currentFolderPath,
    importedAssetState,
    openFolder,
    loadAssetFolders,
    createFolder,
    renameFolder,
    moveFolder,
    moveAssets,
    deleteFolder,
    addPaths,
    chooseAndAdd,
    renameAsset,
    relinkAsset,
    revealAssetInFolder,
    refreshAsset,
    refreshAllAssets,
    requestDelete,
    cancelDelete,
    deleteAssets,
  };
}
