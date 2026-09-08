import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { isAssetSnapshot, type AssetSnapshot } from '../../shared/assets';
import {
  isProjectNotebookSnapshot,
  type ProjectNotebookSnapshot,
} from '../../shared/project-notebook-assets';
import { userMessageFromError } from '../../shared/ipc-error';

export type ProjectNotebookLoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly snapshot: ProjectNotebookSnapshot }
  | { readonly kind: 'error'; readonly message: string };

export interface ProjectNotebookController {
  readonly state: ProjectNotebookLoadState;
  readonly creating: boolean;
  create(name?: string): Promise<AssetSnapshot>;
  select(assetId: string): Promise<void>;
  retry(): Promise<void>;
}

/** State for the notebook-only viewport; Markdown editing stays in its WB. */
export function useProjectNotebook(
  projectId: string,
  enabled: boolean,
): ProjectNotebookController {
  const [state, setState] = useState<ProjectNotebookLoadState>({
    kind: 'idle',
  });
  const [creatingOwner, setCreatingOwner] = useState<{
    readonly projectId: string;
    readonly token: symbol;
  }>();
  const projectEpoch = useRef({ projectId, value: 0 });
  const operationVersion = useRef(0);
  const createInFlight = useRef<Promise<AssetSnapshot> | undefined>(undefined);
  const createToken = useRef<symbol | undefined>(undefined);

  // The same hook instance can be retained while ProjectPage switches
  // projects. Layout effects run before a settled async create/read may
  // update the next Project's view state.
  useLayoutEffect(() => {
    if (projectEpoch.current.projectId === projectId) return;
    projectEpoch.current = {
      projectId,
      value: projectEpoch.current.value + 1,
    };
    operationVersion.current += 1;
    createInFlight.current = undefined;
    createToken.current = undefined;
  }, [projectId]);

  const load = useCallback(async () => {
    if (!enabled) return;
    const epoch = projectEpoch.current.value;
    const operation = operationVersion.current;
    setState({ kind: 'loading' });
    try {
      const snapshot = await window.learningCompanion.getProjectNotebook({
        projectId,
      });
      if (
        projectEpoch.current.value !== epoch ||
        projectEpoch.current.projectId !== projectId ||
        operationVersion.current !== operation ||
        !isProjectNotebookSnapshot(snapshot) ||
        snapshot.projectId !== projectId
      ) {
        return;
      }
      setState({ kind: 'ready', snapshot });
    } catch (error) {
      if (
        projectEpoch.current.value !== epoch ||
        projectEpoch.current.projectId !== projectId ||
        operationVersion.current !== operation
      ) return;
      setState({
        kind: 'error',
        message:
          userMessageFromError(error, '无法打开项目笔记。') ??
          '无法打开项目笔记。',
      });
    }
  }, [enabled, projectId]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    void Promise.resolve().then(load);
    return () => {
      operationVersion.current += 1;
    };
  }, [enabled, load]);

  const create = useCallback((name?: string) => {
    if (createInFlight.current) return createInFlight.current;
    if (!enabled) throw new Error('项目笔记视口尚未准备完成。');
    const epoch = projectEpoch.current.value;
    const operation = operationVersion.current + 1;
    operationVersion.current = operation;
    const token = Symbol('project-notebook-create');
    createToken.current = token;
    setCreatingOwner({ projectId, token });
    const task = (async () => {
      try {
        const asset = await window.learningCompanion.createProjectNotebook({
          projectId,
          ...(name?.trim() ? { name: name.trim() } : {}),
        });
        if (
          !isAssetSnapshot(asset) ||
          asset.projectId !== projectId ||
          asset.mediaType !== 'text/markdown'
        ) {
          throw new Error('新建笔记响应无效。');
        }
        if (
          projectEpoch.current.value === epoch &&
          projectEpoch.current.projectId === projectId &&
          operationVersion.current === operation
        ) {
          setState({
            kind: 'ready',
            snapshot: { projectId, assetId: asset.id },
          });
        }
        return asset;
      } finally {
        if (createToken.current === token) {
          createInFlight.current = undefined;
          createToken.current = undefined;
        }
        // Busy ownership is intentionally independent from whether this
        // result may still select a note. A later select invalidates the
        // selection operation, not this create's UI cleanup.
        setCreatingOwner((current) =>
          current?.token === token ? undefined : current,
        );
      }
    })();
    createInFlight.current = task;
    return task;
  }, [enabled, projectId]);

  const select = useCallback(async (assetId: string) => {
    if (!enabled) throw new Error('项目笔记视口尚未准备完成。');
    const epoch = projectEpoch.current.value;
    const operation = operationVersion.current + 1;
    operationVersion.current = operation;
    const snapshot = await window.learningCompanion.selectProjectNotebookAsset({
      projectId,
      assetId,
    });
    if (
      !isProjectNotebookSnapshot(snapshot) ||
      snapshot.projectId !== projectId ||
      snapshot.assetId !== assetId
    ) {
      throw new Error('项目笔记选择响应无效。');
    }
    if (
      projectEpoch.current.value === epoch &&
      projectEpoch.current.projectId === projectId &&
      operationVersion.current === operation
    ) {
      setState({ kind: 'ready', snapshot });
    }
  }, [enabled, projectId]);

  return {
    state,
    creating: creatingOwner?.projectId === projectId,
    create,
    select,
    retry: load,
  };
}
