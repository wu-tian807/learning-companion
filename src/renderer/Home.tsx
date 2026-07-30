import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_APP_PREFERENCES,
  isAppPreferences,
  type HomePreferences,
  type ProjectSortMode,
  type ProjectViewMode,
} from '../shared/app-preferences';
import { userMessageFromError } from '../shared/ipc-error';
import {
  isProjectSnapshot,
  isProjectSnapshotList,
  type ProjectSnapshot,
} from '../shared/projects';
import { ConfirmDialog } from './components/ConfirmDialog';
import { HomeToolbar } from './components/HomeToolbar';
import { ProjectDialog, type ProjectDialogValues } from './components/ProjectDialog';
import { ProjectGrid } from './components/ProjectGrid';
import { ProjectList } from './components/ProjectList';
import { WorkspaceChangeConfirmDialog } from './components/WorkspaceChangeConfirmDialog';
import { filterAndSortProjects } from './project-view';

type ProjectLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; projects: ProjectSnapshot[] }
  | { kind: 'failed' };

type ProjectEditorState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; project: ProjectSnapshot };

interface PendingWorkspaceChange {
  readonly project: ProjectSnapshot;
  readonly values: ProjectDialogValues;
}

interface HomeProps {
  readonly onOpenProject: (project: ProjectSnapshot) => void;
  readonly onOpenSettings: () => void;
}

function copyHomePreferences(preferences: HomePreferences): HomePreferences {
  return {
    viewMode: preferences.viewMode,
    sortMode: preferences.sortMode,
  };
}

function LoadingProjectGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(245px,1fr))] gap-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="min-h-[230px] animate-pulse rounded-[17px] border border-white/[0.035] bg-white/[0.035] p-6"
        >
          <div className="size-11 rounded-xl bg-white/[0.055]" />
          <div className="mt-24 h-5 w-3/5 rounded bg-white/[0.055]" />
          <div className="mt-3 h-3 w-2/5 rounded bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}

function LoadingProjectList() {
  return (
    <div className="border-t border-white/[0.12]">
      {Array.from({ length: 7 }, (_, index) => (
        <div
          key={index}
          className="flex h-[62px] animate-pulse items-center gap-4 border-b border-white/[0.08] px-4"
        >
          <div className="size-6 rounded bg-white/[0.05]" />
          <div className="h-4 w-1/3 rounded bg-white/[0.05]" />
          <div className="ml-auto h-3 w-1/6 rounded bg-white/[0.035]" />
        </div>
      ))}
    </div>
  );
}

export function Home({
  onOpenProject,
  onOpenSettings,
}: HomeProps) {
  const [loadState, setLoadState] = useState<ProjectLoadState>({ kind: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);
  const [homePreferences, setHomePreferences] = useState<HomePreferences>(() =>
    copyHomePreferences(DEFAULT_APP_PREFERENCES.home),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [editorState, setEditorState] = useState<ProjectEditorState>({ kind: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<ProjectSnapshot | null>(null);
  const [pendingWorkspaceChange, setPendingWorkspaceChange] =
    useState<PendingWorkspaceChange | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const mutationLockRef = useRef(false);
  const displayedHomePreferencesRef = useRef<HomePreferences>(
    copyHomePreferences(DEFAULT_APP_PREFERENCES.home),
  );
  const confirmedHomePreferencesRef = useRef<HomePreferences>(
    copyHomePreferences(DEFAULT_APP_PREFERENCES.home),
  );
  const preferencesMutationVersionRef = useRef(0);
  const { sortMode, viewMode } = homePreferences;

  const applyHomePreferences = useCallback((preferences: HomePreferences) => {
    const nextPreferences = copyHomePreferences(preferences);
    displayedHomePreferencesRef.current = nextPreferences;
    setHomePreferences(nextPreferences);
  }, []);

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

  useEffect(() => {
    let active = true;

    const loadPreferences = async () => {
      try {
        const preferences = await window.learningCompanion.getAppPreferences();

        if (!isAppPreferences(preferences)) {
          throw new Error('Settings 响应格式无效');
        }

        if (active && preferencesMutationVersionRef.current === 0) {
          const restoredHome = copyHomePreferences(preferences.home);
          confirmedHomePreferencesRef.current = restoredHome;
          applyHomePreferences(restoredHome);
        }
      } catch (error) {
        console.error('加载 Settings 失败', error);

        if (active && preferencesMutationVersionRef.current === 0) {
          setSettingsError('无法加载界面设置，已使用默认值。');
        }
      }
    };

    void loadPreferences();

    return () => {
      active = false;
    };
  }, [applyHomePreferences]);

  const projects = useMemo(
    () => (loadState.kind === 'ready' ? loadState.projects : []),
    [loadState],
  );
  const visibleProjects = useMemo(
    () => filterAndSortProjects(projects, searchQuery, sortMode),
    [projects, searchQuery, sortMode],
  );

  const updateProject = useCallback((updatedProject: ProjectSnapshot) => {
    setLoadState((current) => {
      if (current.kind !== 'ready') {
        return current;
      }

      const exists = current.projects.some((project) => project.id === updatedProject.id);
      return {
        kind: 'ready',
        projects: exists
          ? current.projects.map((project) =>
              project.id === updatedProject.id ? updatedProject : project,
            )
          : [...current.projects, updatedProject],
      };
    });
  }, []);

  const runMutation = useCallback(
    async (operation: () => Promise<void>, failureMessage: string): Promise<boolean> => {
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
        const userMessage = userMessageFromError(error, failureMessage);
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

  const persistHomePreferences = useCallback(
    async (nextPreferences: HomePreferences) => {
      const mutationVersion = preferencesMutationVersionRef.current + 1;
      preferencesMutationVersionRef.current = mutationVersion;
      applyHomePreferences(nextPreferences);
      setSettingsError(null);

      try {
        const preferences =
          await window.learningCompanion.updateHomePreferences(nextPreferences);

        if (!isAppPreferences(preferences)) {
          throw new Error('Settings 更新响应格式无效');
        }

        const confirmedHome = copyHomePreferences(preferences.home);
        confirmedHomePreferencesRef.current = confirmedHome;

        if (preferencesMutationVersionRef.current === mutationVersion) {
          applyHomePreferences(confirmedHome);
        }
      } catch (error) {
        console.error('保存 Settings 失败', error);

        if (preferencesMutationVersionRef.current === mutationVersion) {
          applyHomePreferences(confirmedHomePreferencesRef.current);
          setSettingsError('无法保存界面设置，已恢复上一次选择。');
        }
      }
    },
    [applyHomePreferences],
  );

  const changeViewMode = useCallback(
    (viewMode: ProjectViewMode) => {
      void persistHomePreferences({
        ...displayedHomePreferencesRef.current,
        viewMode,
      });
    },
    [persistHomePreferences],
  );

  const changeSortMode = useCallback(
    (sortMode: ProjectSortMode) => {
      void persistHomePreferences({
        ...displayedHomePreferencesRef.current,
        sortMode,
      });
    },
    [persistHomePreferences],
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
      const createdProject = await window.learningCompanion.createProject({
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
        updatedProject = await window.learningCompanion.renameProject({
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
      const updatedProject = await window.learningCompanion.setProjectPinned({
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
              projects: current.projects.filter((project) => project.id !== targetId),
            }
          : current,
      );
    }, '无法删除 Project，请重试。');

    if (succeeded) {
      setDeleteTarget(null);
    }
  };

  const retry = () => {
    setLoadState({ kind: 'loading' });
    setRequestVersion((version) => version + 1);
  };

  const actionHandlers = {
    onEdit: (project: ProjectSnapshot) => {
      setMutationError(null);
      setEditorState({ kind: 'edit', project });
    },
    onOpenWorkspace: (project: ProjectSnapshot) => {
      void runMutation(
        () =>
          window.learningCompanion.openProjectWorkspace({
            projectId: project.id,
          }),
        '无法打开 Project 工作区。',
      );
    },
    onTogglePinned: (project: ProjectSnapshot) => {
      void toggleProjectPinned(project);
    },
    onDelete: (project: ProjectSnapshot) => {
      setMutationError(null);
      setDeleteTarget(project);
    },
  };
  const pageError = mutationError ?? settingsError;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#1f2329] text-slate-100">
      <div className="mx-auto w-full max-w-[1500px] px-8 pt-9 pb-14">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">
            伴学伙伴
          </h1>

          <HomeToolbar
            searchQuery={searchQuery}
            viewMode={viewMode}
            sortMode={sortMode}
            onSearchQueryChange={setSearchQuery}
            onViewModeChange={changeViewMode}
            onSortModeChange={changeSortMode}
            onCreate={openCreateDialog}
            onOpenSettings={onOpenSettings}
          />
        </header>

        {pageError &&
          editorState.kind === 'closed' &&
          !deleteTarget &&
          !pendingWorkspaceChange && (
          <div
            role="alert"
            className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-4 py-3 text-xs text-rose-200"
          >
            <span>{pageError}</span>
            <button
              type="button"
              aria-label="关闭错误提示"
              onClick={() => {
                setMutationError(null);
                setSettingsError(null);
              }}
              className="ui-icon-button grid size-7 place-items-center rounded-full text-base text-rose-200/60"
            >
              ×
            </button>
          </div>
        )}

        {loadState.kind === 'loading' &&
          (viewMode === 'grid' ? <LoadingProjectGrid /> : <LoadingProjectList />)}

        {loadState.kind === 'failed' && (
          <div className="rounded-[17px] border border-rose-300/15 bg-rose-400/[0.04] px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-300">Project 列表加载失败</p>
            <p className="mt-2 text-xs text-slate-500">请确认本地后端正在运行后重试。</p>
            <button
              type="button"
              onClick={retry}
              className="ui-control mt-5 rounded-full border border-white/[0.14] bg-white/[0.06] px-4 py-2 text-xs font-medium text-slate-200"
            >
              重新加载
            </button>
          </div>
        )}

        {loadState.kind === 'ready' && projects.length === 0 && (
          <div className="rounded-[17px] border border-dashed border-white/[0.1] px-6 py-14 text-center">
            <p className="text-sm font-medium text-slate-300">还没有 Project</p>
            <p className="mt-2 text-xs text-slate-500">点击下方创建第一个学习 Project。</p>
            <button
              type="button"
              onClick={openCreateDialog}
              className="ui-primary-button mt-5 rounded-full bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-900"
            >
              ＋ 新建 Project
            </button>
          </div>
        )}

        {loadState.kind === 'ready' &&
          projects.length > 0 &&
          visibleProjects.length === 0 && (
            <div className="rounded-[17px] border border-dashed border-white/[0.1] px-6 py-14 text-center">
              <p className="text-sm font-medium text-slate-300">没有匹配的 Project</p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="ui-control mt-4 rounded-full border border-indigo-200/10 px-4 py-2 text-xs font-medium text-indigo-200"
              >
                清空搜索
              </button>
            </div>
          )}

        {loadState.kind === 'ready' && visibleProjects.length > 0 && viewMode === 'grid' && (
          <ProjectGrid
            projects={visibleProjects}
            actionsDisabled={mutationBusy}
            onOpenProject={onOpenProject}
            {...actionHandlers}
          />
        )}

        {loadState.kind === 'ready' && visibleProjects.length > 0 && viewMode === 'list' && (
          <ProjectList
            projects={visibleProjects}
            actionsDisabled={mutationBusy}
            onOpenProject={onOpenProject}
            {...actionHandlers}
          />
        )}
      </div>

      {editorState.kind === 'create' && (
        <ProjectDialog
          mode="create"
          busy={mutationBusy}
          error={mutationError}
          onClose={closeEditor}
          onSelectWorkspace={() =>
            window.learningCompanion.selectProjectWorkspace({})
          }
          onSubmit={(values) => {
            void createProject(values);
          }}
        />
      )}

      {editorState.kind === 'edit' && (
        <ProjectDialog
          mode="edit"
          initialName={editorState.project.name}
          initialWorkspacePath={editorState.project.workspacePath}
          busy={mutationBusy}
          error={mutationError}
          onClose={closeEditor}
          onSelectWorkspace={() =>
            window.learningCompanion.selectProjectWorkspace({
              projectId: editorState.project.id,
            })
          }
          onOpenWorkspace={() =>
            window.learningCompanion.openProjectWorkspace({
              projectId: editorState.project.id,
            })
          }
          onSubmit={(values) => {
            void editProject(values);
          }}
        />
      )}

      {pendingWorkspaceChange && (
        <WorkspaceChangeConfirmDialog
          busy={mutationBusy}
          error={mutationError}
          onClose={() => {
            if (!mutationLockRef.current) {
              setPendingWorkspaceChange(null);
              setMutationError(null);
            }
          }}
          onConfirm={() => {
            void saveProject(
              pendingWorkspaceChange.project,
              pendingWorkspaceChange.values,
            );
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          projectName={deleteTarget.name}
          busy={mutationBusy}
          error={mutationError}
          onClose={closeDeleteDialog}
          onConfirm={() => {
            void deleteProject();
          }}
        />
      )}
    </main>
  );
}
