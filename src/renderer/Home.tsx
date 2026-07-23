import { useEffect, useState } from 'react';

import type { ProjectSummary } from '../shared/ipc';
import { isProjectSummaryList } from '../shared/ipc';
import { formatProjectDate, formatSourceCount, getProjectCardColor } from './project-view';

type ProjectLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; projects: ProjectSummary[] }
  | { kind: 'failed' };

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function CreateProjectCard() {
  return (
    <button
      type="button"
      aria-label="创建新 Project，功能即将开放"
      className="flex min-h-[230px] flex-col items-center justify-center gap-4 rounded-[17px] border border-white/[0.1] bg-black/10 text-slate-100 transition-colors hover:border-indigo-300/30 hover:bg-white/[0.025]"
    >
      <span className="grid size-16 place-items-center rounded-full bg-[#343650] text-[31px] font-light text-indigo-200">
        ＋
      </span>
      <span className="text-[17px] font-medium">创建新 Project</span>
    </button>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <article
      className="group flex min-h-[230px] flex-col justify-between overflow-hidden rounded-[17px] border border-white/[0.035] p-6 shadow-[0_10px_28px_rgba(7,9,12,0.08)] transition duration-150 hover:-translate-y-0.5 hover:border-indigo-200/20 hover:shadow-[0_18px_40px_rgba(7,9,12,0.18)]"
      style={{ backgroundColor: getProjectCardColor(project.id) }}
    >
      <div className="flex items-start justify-between">
        <span className="text-[43px] leading-none drop-shadow-[0_6px_10px_rgba(0,0,0,0.16)]">
          {project.icon}
        </span>
        <button
          type="button"
          aria-label={`${project.name} 的更多操作，功能即将开放`}
          className="grid size-8 place-items-center rounded-lg text-indigo-100/55 transition hover:bg-white/[0.06] hover:text-indigo-100"
        >
          <span className="size-5">
            <MoreIcon />
          </span>
        </button>
      </div>

      <div>
        <h2 className="mb-2 line-clamp-2 text-[19px] leading-[1.35] font-medium text-slate-100">
          {project.name}
        </h2>
        <p className="text-xs text-slate-300/75">
          {formatProjectDate(project.createdTime)} · {formatSourceCount(project.sources.length)}
        </p>
      </div>
    </article>
  );
}

function LoadingCards() {
  return (
    <>
      {Array.from({ length: 7 }, (_, index) => (
        <div
          key={index}
          className="min-h-[230px] animate-pulse rounded-[17px] border border-white/[0.035] bg-white/[0.035] p-6"
        >
          <div className="size-11 rounded-xl bg-white/[0.055]" />
          <div className="mt-24 h-5 w-3/5 rounded bg-white/[0.055]" />
          <div className="mt-3 h-3 w-2/5 rounded bg-white/[0.04]" />
        </div>
      ))}
    </>
  );
}

export function Home() {
  const [loadState, setLoadState] = useState<ProjectLoadState>({ kind: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;

    const loadProjects = async () => {
      try {
        const projects = await window.learningCompanion.listProjects();

        if (!isProjectSummaryList(projects)) {
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

  const retry = () => {
    setLoadState({ kind: 'loading' });
    setRequestVersion((version) => version + 1);
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#1f2329] text-slate-100">
      <div className="mx-auto w-full max-w-[1500px] px-8 pt-6 pb-14">
        <nav
          aria-label="Project 筛选与显示方式"
          className="flex items-center justify-between gap-6"
        >
          <div role="tablist" aria-label="Project 分类" className="flex items-center gap-2">
            <button
              type="button"
              role="tab"
              aria-selected="false"
              className="rounded-full border border-transparent px-3.5 py-2 text-sm text-slate-400"
            >
              全部
            </button>
            <button
              type="button"
              role="tab"
              aria-selected="true"
              className="rounded-full border border-indigo-300/80 bg-indigo-400/10 px-3.5 py-2 text-sm text-slate-50 shadow-[0_0_0_3px_rgba(139,142,234,0.15)]"
            >
              我的 Projects
            </button>
            <button
              type="button"
              role="tab"
              aria-selected="false"
              className="rounded-full border border-transparent px-3.5 py-2 text-sm text-slate-400"
            >
              精选
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label="搜索 Project，功能即将开放"
              className="grid size-[42px] place-items-center rounded-full border border-white/[0.13] bg-black/10 text-slate-300"
            >
              <span className="size-[19px]">
                <SearchIcon />
              </span>
            </button>

            <div
              aria-label="卡片密度"
              className="flex overflow-hidden rounded-[13px] border border-white/[0.13] bg-black/10 max-[1060px]:hidden"
            >
              <button
                type="button"
                aria-pressed="true"
                className="h-10 border-r border-white/[0.13] bg-[#343650] px-3.5 text-xs font-medium text-white"
              >
                舒展
              </button>
              <button
                type="button"
                aria-pressed="false"
                className="h-10 px-3.5 text-xs text-slate-400"
              >
                紧凑
              </button>
            </div>

            <button
              type="button"
              className="flex h-[42px] items-center justify-center gap-[9px] rounded-full border border-white/[0.13] bg-black/10 px-[18px] text-xs text-slate-300 max-[970px]:hidden"
            >
              <span>最近创建</span>
              <span className="size-3 text-slate-500">
                <ChevronDownIcon />
              </span>
            </button>

            <button
              type="button"
              aria-label="新建 Project，功能即将开放"
              className="h-[42px] rounded-full border border-white bg-slate-50 px-[18px] text-xs font-semibold text-slate-900"
            >
              ＋ 新建 Project
            </button>
          </div>
        </nav>

        <header className="mt-14 mb-[22px]">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">
            我的 Projects
          </h1>
          <p className="mt-2 text-[13px] text-slate-500">
            每个 Project 聚合学习资料、对话和沉淀下来的笔记。
          </p>
        </header>

        <section
          aria-label="Project 列表"
          className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4"
        >
          <CreateProjectCard />

          {loadState.kind === 'loading' && <LoadingCards />}

          {loadState.kind === 'ready' &&
            loadState.projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}

          {loadState.kind === 'ready' && loadState.projects.length === 0 && (
            <div className="col-span-full rounded-[17px] border border-dashed border-white/[0.1] px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-300">还没有 Project</p>
              <p className="mt-2 text-xs text-slate-500">创建入口将在下一阶段开放。</p>
            </div>
          )}

          {loadState.kind === 'failed' && (
            <div className="col-span-full rounded-[17px] border border-rose-300/15 bg-rose-400/[0.04] px-6 py-10 text-center">
              <p className="text-sm font-medium text-slate-300">Project 列表加载失败</p>
              <p className="mt-2 text-xs text-slate-500">请确认本地后端正在运行后重试。</p>
              <button
                type="button"
                onClick={retry}
                className="mt-5 rounded-full border border-white/[0.14] bg-white/[0.06] px-4 py-2 text-xs font-medium text-slate-200"
              >
                重新加载
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
