import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { userMessageFromError } from '../../shared/ipc-error';
import {
  isProjectSnapshot,
  isProjectSnapshotList,
  type ProjectSnapshot,
} from '../../shared/projects';
import type { ProjectActionHandlers } from '../components/ProjectActionsMenu';
import type { ProjectDialogValues } from '../components/ProjectDialog';

export type ProjectLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly projects: ProjectSnapshot[] }
  | { readonly kind: 'failed' };

export type ProjectEditorState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly project: ProjectSnapshot };

export interface PendingWorkspaceChange {
  readonly project: ProjectSnapshot;
  readonly values: ProjectDialogValues;
}

export function useProjects() {
  const [loadState, setLoadState] = useState<ProjectLoadState>({
    kind: 'loading',
  });
  const [requestVersion, setRequestVersion] = useState(0);
  const [editorState, setEditorState] =
    useState<ProjectEditorState>({ kind: 'closed' });
  const [deleteTarget, setDeleteTarget] =
    useState<ProjectSnapshot | null>(null);
  const [pendingWorkspaceChange, setPendingWorkspaceChange] =
    useState<PendingWorkspaceChange | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] =
    useState<string | null>(null);
  const mutationLockRef = useRef(false);

  useEffect(() => {
    let active = true;

    const loadProjects = async () => {
      try {
        const projects = await window.learningCompanion.listProjects();

        if (!isProjectSnapshotList(projects)) {
          throw new Error('Project 列表响应格式无效');
        }

        if (active) {
          setLoadState({ kind: 'ready', projects });
        }
      } catch (error) {
        console.error('加载 Project 列表失败', error);

        if (active) {
          setLoadState({ kind: 'failed' });
        }
      }
    };

    void loadProjects();

    return () => {
      active = false;
    };
  }, [requestVersion]);

  const projects = useMemo(
    () => (loadState.kind === 'ready' ? loadState.projects : []),
    [loadState],
  );
  const updateProject = useCallback(
    (updatedProject: ProjectSnapshot) => {
      setLoadState((current) => {
        if (current.kind !== 'ready') {
          return current;
        }

        const exists = current.projects.some(
          (project) => project.id === updatedProject.id,
        );
        return {
          kind: 'ready',
          projects: exists
            ? current.projects.map((project) =>
                project.id === updatedProject.id
                  ? updatedProject
                  : project,
              )
            : [...current.projects, updatedProject],
        };
      });
    },
    [],
  );
  const runMutation = useCallback(
    async (
      operation: () => Promise<void>,
      failureMessage: string,
    ): Promise<boolean> => {
      if (mutationLockRef.current) {
        return false;
      }

      mutationLockRef.current = true;
      setMutationBusy(true);
      setMutationError(null);

      try {
        await operation();
        return true;
      } catch (error) {
        const userMessage = userMessageFromError(
          error,
          failureMessage,
        );
        if (userMessage) {
          console.error(userMessage, error);
          setMutationError(userMessage);
        }
        return false;
      } finally {
        mutationLockRef.current = false;
        setMutationBusy(false);
      }
    },
    [],
  );
  const openCreateDialog = useCallback(() => {
    setMutationError(null);
    setEditorState({ kind: 'create' });
  }, []);
  const closeEditor = useCallback(() => {
    if (!mutationLockRef.current) {
      setEditorState({ kind: 'closed' });
      setMutationError(null);
    }
  }, []);
  const closeDeleteDialog = useCallback(() => {
    if (!mutationLockRef.current) {
      setDeleteTarget(null);
      setMutationError(null);
    }
  }, []);
  const createProject = async ({
    name,
    workspacePath,
  }: ProjectDialogValues) => {
    const succeeded = await runMutation(async () => {
      const createdProject =
        await window.learningCompanion.createProject({
          name,
          ...(workspacePath ? { workspacePath } : {}),
        });

      if (!isProjectSnapshot(createdProject)) {
        throw new Error('Project 创建响应格式无效');
      }

      updateProject(createdProject);
    }, '无法创建 Project，请重试。');

    if (succeeded) {
      setEditorState({ kind: 'closed' });
    }
  };
  const saveProject = async (
    project: ProjectSnapshot,
    values: ProjectDialogValues,
  ) => {
    const succeeded = await runMutation(async () => {
      let updatedProject = project;

      if (
        values.workspacePath &&
        values.workspacePath !== project.workspacePath
      ) {
        updatedProject =
          await window.learningCompanion.changeProjectWorkspace({
            projectId: project.id,
            workspacePath: values.workspacePath,
          });

        if (!isProjectSnapshot(updatedProject)) {
          throw new Error('Project 工作区更新响应格式无效');
        }
      }

      if (values.name !== updatedProject.name) {
        updatedProject =
          await window.learningCompanion.renameProject({
            id: project.id,
            name: values.name,
          });

        if (!isProjectSnapshot(updatedProject)) {
          throw new Error('Project 重命名响应格式无效');
        }
      }

      updateProject(updatedProject);
    }, '无法保存 Project，请重试。');

    if (succeeded) {
      setEditorState({ kind: 'closed' });
      setPendingWorkspaceChange(null);
    }
  };
  const editProject = async (values: ProjectDialogValues) => {
    if (editorState.kind !== 'edit') {
      return;
    }

    if (
      values.workspacePath &&
      values.workspacePath !== editorState.project.workspacePath
    ) {
      setPendingWorkspaceChange({
        project: editorState.project,
        values,
      });
      return;
    }

    await saveProject(editorState.project, values);
  };
  const toggleProjectPinned = async (project: ProjectSnapshot) => {
    await runMutation(async () => {
      const updatedProject =
        await window.learningCompanion.setProjectPinned({
          id: project.id,
          pinned: !project.pinned,
        });

      if (!isProjectSnapshot(updatedProject)) {
        throw new Error('Project 置顶响应格式无效');
      }

      updateProject(updatedProject);
    }, project.pinned ? '无法取消置顶，请重试。' : '无法置顶 Project，请重试。');
  };
  const deleteProject = async () => {
    if (!deleteTarget) {
      return;
    }

    const targetId = deleteTarget.id;
    const succeeded = await runMutation(async () => {
      await window.learningCompanion.deleteProject({ id: targetId });
      setLoadState((current) =>
        current.kind === 'ready'
          ? {
              kind: 'ready',
              projects: current.projects.filter(
                (project) => project.id !== targetId,
              ),
            }
          : current,
      );
    }, '无法删除 Project，请重试。');

    if (succeeded) {
      setDeleteTarget(null);
    }
  };
  const projectActions: ProjectActionHandlers = {
    onEdit: (project) => {
      setMutationError(null);
      setEditorState({ kind: 'edit', project });
    },
    onOpenWorkspace: (project) => {
      void runMutation(
        () =>
          window.learningCompanion.openProjectWorkspace({
            projectId: project.id,
          }),
        '无法打开 Project 工作区。',
      );
    },
    onTogglePinned: (project) => {
      void toggleProjectPinned(project);
    },
    onDelete: (project) => {
      setMutationError(null);
      setDeleteTarget(project);
    },
  };

  return {
    loadState,
    projects,
    retry: () => {
      setLoadState({ kind: 'loading' });
      setRequestVersion((version) => version + 1);
    },
    editorState,
    openCreateDialog,
    closeEditor,
    createProject,
    editProject,
    deleteTarget,
    closeDeleteDialog,
    deleteProject,
    pendingWorkspaceChange,
    closePendingWorkspaceChange: () => {
      if (!mutationLockRef.current) {
        setPendingWorkspaceChange(null);
        setMutationError(null);
      }
    },
    confirmPendingWorkspaceChange: () => {
      if (pendingWorkspaceChange) {
        return saveProject(
          pendingWorkspaceChange.project,
          pendingWorkspaceChange.values,
        );
      }
      return Promise.resolve();
    },
    mutationBusy,
    mutationError,
    clearMutationError: () => setMutationError(null),
    projectActions,
  };
}
