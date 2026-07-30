import { useMemo, useState } from 'react';

import type { ProjectSnapshot } from '../../shared/projects';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HomeToolbar } from '../components/HomeToolbar';
import { ProjectDialog } from '../components/ProjectDialog';
import { ProjectGrid } from '../components/ProjectGrid';
import { ProjectList } from '../components/ProjectList';
import { WorkspaceChangeConfirmDialog } from '../components/WorkspaceChangeConfirmDialog';
import { filterAndSortProjects } from '../project-view';
import { useHomePreferences } from './use-home-preferences';
import { useProjects } from './use-projects';

interface HomeProps {
  readonly onOpenProject: (project: ProjectSnapshot) => void;
  readonly onOpenSettings: () => void;
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
  const [searchQuery, setSearchQuery] = useState('');
  const projectsState = useProjects();
  const preferences = useHomePreferences();
  const visibleProjects = useMemo(
    () =>
      filterAndSortProjects(
        projectsState.projects,
        searchQuery,
        preferences.sortMode,
      ),
    [preferences.sortMode, projectsState.projects, searchQuery],
  );
  const pageError =
    projectsState.mutationError ?? preferences.settingsError;
  const editingProject =
    projectsState.editorState.kind === 'edit'
      ? projectsState.editorState.project
      : undefined;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#1f2329] text-slate-100">
      <div className="mx-auto w-full max-w-[1500px] px-8 pt-9 pb-14">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">
            伴学伙伴
          </h1>

          <HomeToolbar
            searchQuery={searchQuery}
            viewMode={preferences.viewMode}
            sortMode={preferences.sortMode}
            onSearchQueryChange={setSearchQuery}
            onViewModeChange={preferences.changeViewMode}
            onSortModeChange={preferences.changeSortMode}
            onCreate={projectsState.openCreateDialog}
            onOpenSettings={onOpenSettings}
          />
        </header>

        {pageError &&
          projectsState.editorState.kind === 'closed' &&
          !projectsState.deleteTarget &&
          !projectsState.pendingWorkspaceChange && (
            <div
              role="alert"
              className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-4 py-3 text-xs text-rose-200"
            >
              <span>{pageError}</span>
              <button
                type="button"
                aria-label="关闭错误提示"
                onClick={() => {
                  projectsState.clearMutationError();
                  preferences.clearSettingsError();
                }}
                className="ui-icon-button grid size-7 place-items-center rounded-full text-base text-rose-200/60"
              >
                ×
              </button>
            </div>
          )}

        {projectsState.loadState.kind === 'loading' &&
          (preferences.viewMode === 'grid' ? (
            <LoadingProjectGrid />
          ) : (
            <LoadingProjectList />
          ))}

        {projectsState.loadState.kind === 'failed' && (
          <div className="rounded-[17px] border border-rose-300/15 bg-rose-400/[0.04] px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-300">
              Project 列表加载失败
            </p>
            <p className="mt-2 text-xs text-slate-500">
              请确认本地后端正在运行后重试。
            </p>
            <button
              type="button"
              onClick={projectsState.retry}
              className="ui-control mt-5 rounded-full border border-white/[0.14] bg-white/[0.06] px-4 py-2 text-xs font-medium text-slate-200"
            >
              重新加载
            </button>
          </div>
        )}

        {projectsState.loadState.kind === 'ready' &&
          projectsState.projects.length === 0 && (
            <div className="rounded-[17px] border border-dashed border-white/[0.1] px-6 py-14 text-center">
              <p className="text-sm font-medium text-slate-300">
                还没有 Project
              </p>
              <p className="mt-2 text-xs text-slate-500">
                点击下方创建第一个学习 Project。
              </p>
              <button
                type="button"
                onClick={projectsState.openCreateDialog}
                className="ui-primary-button mt-5 rounded-full bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-900"
              >
                ＋ 新建 Project
              </button>
            </div>
          )}

        {projectsState.loadState.kind === 'ready' &&
          projectsState.projects.length > 0 &&
          visibleProjects.length === 0 && (
            <div className="rounded-[17px] border border-dashed border-white/[0.1] px-6 py-14 text-center">
              <p className="text-sm font-medium text-slate-300">
                没有匹配的 Project
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="ui-control mt-4 rounded-full border border-indigo-200/10 px-4 py-2 text-xs font-medium text-indigo-200"
              >
                清空搜索
              </button>
            </div>
          )}

        {projectsState.loadState.kind === 'ready' &&
          visibleProjects.length > 0 &&
          preferences.viewMode === 'grid' && (
            <ProjectGrid
              projects={visibleProjects}
              actionsDisabled={projectsState.mutationBusy}
              onOpenProject={onOpenProject}
              {...projectsState.projectActions}
            />
          )}

        {projectsState.loadState.kind === 'ready' &&
          visibleProjects.length > 0 &&
          preferences.viewMode === 'list' && (
            <ProjectList
              projects={visibleProjects}
              actionsDisabled={projectsState.mutationBusy}
              onOpenProject={onOpenProject}
              {...projectsState.projectActions}
            />
          )}
      </div>

      {projectsState.editorState.kind === 'create' && (
        <ProjectDialog
          mode="create"
          busy={projectsState.mutationBusy}
          error={projectsState.mutationError}
          onClose={projectsState.closeEditor}
          onSelectWorkspace={() =>
            window.learningCompanion.selectProjectWorkspace({})
          }
          onSubmit={(values) => {
            void projectsState.createProject(values);
          }}
        />
      )}

      {editingProject && (
        <ProjectDialog
          mode="edit"
          initialName={editingProject.name}
          initialWorkspacePath={editingProject.workspacePath}
          busy={projectsState.mutationBusy}
          error={projectsState.mutationError}
          onClose={projectsState.closeEditor}
          onSelectWorkspace={() =>
            window.learningCompanion.selectProjectWorkspace({
              projectId: editingProject.id,
            })
          }
          onOpenWorkspace={() =>
            window.learningCompanion.openProjectWorkspace({
              projectId: editingProject.id,
            })
          }
          onSubmit={(values) => {
            void projectsState.editProject(values);
          }}
        />
      )}

      {projectsState.pendingWorkspaceChange && (
        <WorkspaceChangeConfirmDialog
          busy={projectsState.mutationBusy}
          error={projectsState.mutationError}
          onClose={projectsState.closePendingWorkspaceChange}
          onConfirm={() => {
            void projectsState.confirmPendingWorkspaceChange();
          }}
        />
      )}

      {projectsState.deleteTarget && (
        <ConfirmDialog
          projectName={projectsState.deleteTarget.name}
          busy={projectsState.mutationBusy}
          error={projectsState.mutationError}
          onClose={projectsState.closeDeleteDialog}
          onConfirm={() => {
            void projectsState.deleteProject();
          }}
        />
      )}
    </main>
  );
}
