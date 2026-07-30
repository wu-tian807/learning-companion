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
  onOpenSettings: () => void;
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

const sortOptions = Object.entries(sortLabels) as [ProjectSortMode, string][];

function CheckIcon() {
  return (
    <svg className="size-full" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m3 8 3 3 7-7" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      className="size-full"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="2.5" />
      <path d="M16.2 11.4v-2.8l-1.8-.5a5 5 0 0 0-.5-1.1l.9-1.7-2-2-1.7.9a5 5 0 0 0-1.1-.5L9.4 2H6.6l-.5 1.8a5 5 0 0 0-1.1.5l-1.7-.9-2 2 .9 1.7a5 5 0 0 0-.5 1.1L0 8.6v2.8l1.8.5a5 5 0 0 0 .5 1.1l-.9 1.7 2 2 1.7-.9a5 5 0 0 0 1.1.5l.5 1.8h2.8l.5-1.8a5 5 0 0 0 1.1-.5l1.7.9 2-2-.9-1.7a5 5 0 0 0 .5-1.1l1.8-.5Z" transform="translate(2 0) scale(.8 1)" />
    </svg>
  );
}

export function HomeToolbar({
  searchQuery,
  viewMode,
  sortMode,
  onSearchQueryChange,
  onViewModeChange,
  onSortModeChange,
  onCreate,
  onOpenSettings,
}: HomeToolbarProps) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchExpanded) {
      searchInputRef.current?.focus();
    }
  }, [searchExpanded]);

  useEffect(() => {
    if (!sortOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        setSortOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSortOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [sortOpen]);

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
        className={`ui-control flex h-11 items-center overflow-hidden rounded-full border border-white/[0.14] bg-black/10 text-slate-300 transition-[width] duration-200 ${
          searchExpanded ? 'w-[210px]' : 'w-11'
        }`}
      >
        <button
          type="button"
          aria-label="搜索 Project"
          aria-expanded={searchExpanded}
          onClick={() => setSearchExpanded(true)}
          className="ui-icon-button grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-300"
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
                className="ui-icon-button mr-2 grid size-6 shrink-0 place-items-center rounded-full text-xs text-slate-500"
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
          className={`ui-icon-button grid w-12 place-items-center border-r border-white/[0.13] transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-300 ${
            viewMode === 'grid'
              ? 'bg-[#383a57] text-indigo-100'
              : 'text-slate-400'
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
          className={`ui-icon-button grid w-12 place-items-center transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-300 ${
            viewMode === 'list'
              ? 'bg-[#383a57] text-indigo-100'
              : 'text-slate-400'
          }`}
        >
          <span className="size-5">
            <ListIcon />
          </span>
        </button>
      </div>

      <div ref={sortMenuRef} className="relative">
        <button
          type="button"
          aria-label="Project 排序方式"
          aria-haspopup="listbox"
          aria-expanded={sortOpen}
          onClick={() => setSortOpen((current) => !current)}
          className="ui-control flex h-11 w-[142px] items-center justify-between rounded-full border border-white/[0.14] bg-black/10 px-4 text-sm text-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          <span>{sortLabels[sortMode]}</span>
          <span
            className={`size-3 text-slate-500 transition-transform duration-150 motion-reduce:transition-none ${
              sortOpen ? 'rotate-180' : ''
            }`}
          >
            <ChevronDownIcon />
          </span>
        </button>

        {sortOpen && (
          <div
            role="listbox"
            aria-label="选择 Project 排序方式"
            className="absolute top-13 right-0 z-40 w-44 rounded-xl border border-white/[0.14] bg-[#292e36] p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.44)]"
          >
            {sortOptions.map(([value, label]) => {
              const selected = value === sortMode;

              return (
                <button
                  key={value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onSortModeChange(value);
                    setSortOpen(false);
                  }}
                  className={`ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ${
                    selected ? 'bg-indigo-300/10 text-indigo-100' : 'text-slate-300'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`size-4 ${selected ? 'text-indigo-200' : 'opacity-0'}`}>
                    <CheckIcon />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onCreate}
        className="ui-primary-button h-11 rounded-full border border-white bg-slate-50 px-5 text-sm font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
      >
        ＋ 新建 Project
      </button>

      <button
        type="button"
        aria-label="打开设置"
        onClick={onOpenSettings}
        className="ui-icon-button grid size-11 place-items-center rounded-full border border-white/[0.14] bg-black/10 text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
      >
        <span className="size-[18px]">
          <SettingsIcon />
        </span>
      </button>
    </div>
  );
}
