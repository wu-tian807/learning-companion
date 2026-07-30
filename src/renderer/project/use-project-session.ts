import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import { isAssetSnapshotList } from '../../shared/assets';
import { userMessageFromError } from '../../shared/ipc-error';
import { selectInitialAssetId } from '../asset-view';
import type { AssetLoadState } from './project-asset-view';

export interface ProjectSessionState {
  readonly loadState: AssetLoadState;
  readonly setLoadState: Dispatch<SetStateAction<AssetLoadState>>;
  readonly selectedAssetId: string | null;
  readonly selectAsset: (assetId: string | null) => void;
  readonly retry: () => void;
  readonly workbenchLifecycleTaskRef:
    MutableRefObject<Promise<void>>;
  readonly handleWorkbenchLifecycleTask: (
    task: Promise<void>,
  ) => void;
}

export function useProjectSession(
  projectId: string,
  onError: (message: string) => void,
): ProjectSessionState {
  const [loadState, setLoadState] = useState<AssetLoadState>({
    kind: 'loading',
  });
  const [requestVersion, setRequestVersion] = useState(0);
  const [selectedAssetId, setSelectedAssetId] =
    useState<string | null>(null);
  const projectLifecycleTaskRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const workbenchLifecycleTaskRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const handleWorkbenchLifecycleTask = useCallback(
    (task: Promise<void>) => {
      workbenchLifecycleTaskRef.current = task;
    },
    [],
  );
  const selectAsset = useCallback((assetId: string | null) => {
    setSelectedAssetId(assetId);
  }, []);
  const retry = useCallback(() => {
    setLoadState({ kind: 'loading' });
    setRequestVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const previousProjectLifecycle = projectLifecycleTaskRef.current;

    const open = async () => {
      try {
        await previousProjectLifecycle;

        if (!active) {
          return;
        }

        const assets = await window.learningCompanion.openProject({
          projectId,
        });

        if (!isAssetSnapshotList(assets)) {
          throw new Error('Project Asset 列表响应无效');
        }

        if (active) {
          setLoadState({ kind: 'ready', assets });
          selectAsset(selectInitialAssetId(assets));
        }
      } catch (loadError) {
        const message = userMessageFromError(
          loadError,
          '无法加载 Project 资料，请重试。',
        );

        if (!message) {
          return;
        }

        console.error('加载 Project Asset 失败', loadError);
        if (!active) {
          return;
        }

        onError(message);
        setLoadState({ kind: 'failed' });
      }
    };

    const openingTask = open();

    return () => {
      active = false;
      const workbenchLifecycleTask =
        workbenchLifecycleTaskRef.current;
      const closingTask = Promise.allSettled([
        openingTask,
        workbenchLifecycleTask,
      ])
        .then(() =>
          window.learningCompanion.closeProject({ projectId }),
        )
        .catch((closeError: unknown) => {
          const message = userMessageFromError(
            closeError,
            '无法正确关闭 Project。',
          );
          if (message) {
            console.error(message, closeError);
          }
        });
      projectLifecycleTaskRef.current = closingTask;
    };
  }, [onError, projectId, requestVersion, selectAsset]);

  return {
    loadState,
    setLoadState,
    selectedAssetId,
    selectAsset,
    retry,
    workbenchLifecycleTaskRef,
    handleWorkbenchLifecycleTask,
  };
}
