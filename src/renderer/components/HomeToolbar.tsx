import { useEffect, useRef, useState } from 'react';

import type { ProjectSortMode, ProjectViewMode } from '../project-view';

interface HomeToolbarProps {
  searchQuery: string;
  viewMode: ProjectViewMode;
  sortMode: ProjectSortMode;
  onSearchQueryChange: (query: string) => void;
  onViewModeChange: (mode: ProjectViewMode) => void;
  onSortModeChange: (mode: ProjectSortMode) => void;
  onCreate: () => void;
}

function SearchIcon() {
  return (
    <svg className="size-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg className="size-full" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2.5" y="2.5" width="5.5" height="5.5" />
      <rect x="12" y="2.5" width="5.5" height="5.5" />
      <rect x="2.5" y="12" width="5.5" height="5.5" />
      <rect x="12" y="12" width="5.5" height="5.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg className="size-full" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="size-full" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

const sortLabels: Record<ProjectSortMode, string> = {
  newest: '最近创建',
  oldest: '最早创建',
  title: '标题',
};

export function HomeToolbar({
  searchQuery,
  viewMode,
  sortMode,
  onSearchQueryChange,
  onViewModeChange,
  onSortModeChange,
  onCreate,
}: HomeToolbarProps) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchExpanded) {
      searchInputRef.current?.focus();
    }
  }, [searchExpanded]);

  return (
    <div
      role="toolbar"
      aria-label="Project 工具栏"
      className="flex flex-wrap items-center justify-end gap-2.5"
    >
      <div
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            if (searchQuery.length === 0) {
              setSearchExpanded(false);
            }
          }
        }}
        className={`flex h-11 items-center overflow-hidden rounded-full border border-white/[0.14] bg-black/10 text-slate-300 transition-[width] duration-200 ${
          searchExpanded ? 'w-[210px]' : 'w-11'
        }`}
      >
        <button
          type="button"
          aria-label="搜索 Project"
          aria-expanded={searchExpanded}
          onClick={() => setSearchExpanded(true)}
          className="grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-300"
        >
          <span className="size-[19px]">
            <SearchIcon />
          </span>
        </button>
        {searchExpanded && (
          <>
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="筛选 Project"
              aria-label="按标题筛选 Project"
              className="min-w-0 flex-1 bg-transparent pr-1 text-sm text-slate-100 outline-none placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => onSearchQueryChange('')}
                className="mr-2 grid size-6 shrink-0 place-items-center rounded-full text-xs text-slate-500 hover:bg-white/[0.07] hover:text-slate-300"
              >
                ×
              </button>
            )}
          </>
        )}
      </div>

      <div
        role="group"
        aria-label="Project 显示方式"
        className="flex h-11 overflow-hidden rounded-[13px] border border-white/[0.14] bg-black/10"
      >
        <button
          type="button"
          aria-label="舒展卡片视图"
          aria-pressed={viewMode === 'grid'}
          onClick={() => onViewModeChange('grid')}
          className={`grid w-12 place-items-center border-r border-white/[0.13] transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-300 ${
            viewMode === 'grid'
              ? 'bg-[#383a57] text-indigo-100'
              : 'text-slate-400 hover:bg-white/[0.04]'
          }`}
        >
          <span className="size-5">
            <GridIcon />
          </span>
        </button>
        <button
          type="button"
          aria-label="列表视图"
          aria-pressed={viewMode === 'list'}
          onClick={() => onViewModeChange('list')}
          className={`grid w-12 place-items-center transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-300 ${
            viewMode === 'list'
              ? 'bg-[#383a57] text-indigo-100'
              : 'text-slate-400 hover:bg-white/[0.04]'
          }`}
        >
          <span className="size-5">
            <ListIcon />
          </span>
        </button>
      </div>

      <label className="relative flex h-11 items-center rounded-full border border-white/[0.14] bg-black/10 text-sm text-slate-300">
        <span className="pointer-events-none absolute left-4">{sortLabels[sortMode]}</span>
        <select
          value={sortMode}
          aria-label="Project 排序方式"
          onChange={(event) => onSortModeChange(event.target.value as ProjectSortMode)}
          className="h-full w-[142px] cursor-pointer appearance-none rounded-full bg-transparent pr-10 pl-4 text-transparent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          <option value="newest" className="bg-[#292e36] text-slate-100">
            最近创建
          </option>
          <option value="oldest" className="bg-[#292e36] text-slate-100">
            最早创建
          </option>
          <option value="title" className="bg-[#292e36] text-slate-100">
            标题
          </option>
        </select>
        <span className="pointer-events-none absolute right-4 size-3 text-slate-500">
          <ChevronDownIcon />
        </span>
      </label>

      <button
        type="button"
        onClick={onCreate}
        className="h-11 rounded-full border border-white bg-slate-50 px-5 text-sm font-semibold text-slate-900 transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
      >
        ＋ 新建 Project
      </button>
    </div>
  );
}
