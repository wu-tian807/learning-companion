import { useEffect, useRef, useState } from 'react';

import type { ProjectSummary } from '../../shared/ipc';

export interface ProjectActionHandlers {
  onRename: (project: ProjectSummary) => void;
  onTogglePinned: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
}

interface ProjectActionsMenuProps extends ProjectActionHandlers {
  project: ProjectSummary;
  disabled?: boolean;
}

function MoreIcon() {
  return (
    <svg className="size-full" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

export function ProjectActionsMenu({
  project,
  disabled = false,
  onRename,
  onTogglePinned,
  onDelete,
}: ProjectActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const run = (action: (target: ProjectSummary) => void) => {
    setOpen(false);
    action(project);
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label={`${project.name} 的更多操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="ui-icon-button grid size-9 place-items-center rounded-lg text-indigo-100/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:opacity-40"
      >
        <span className="size-5">
          <MoreIcon />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`${project.name} 的操作`}
          className="absolute top-10 right-0 z-30 w-40 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 text-sm shadow-[0_18px_45px_rgba(0,0,0,0.42)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onRename)}
            className="ui-menu-item flex w-full items-center rounded-lg px-3 py-2 text-left text-slate-200"
          >
            编辑标题
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onTogglePinned)}
            className="ui-menu-item flex w-full items-center rounded-lg px-3 py-2 text-left text-slate-200"
          >
            {project.pinned ? '取消置顶' : '置顶'}
          </button>
          <div className="my-1 h-px bg-white/[0.08]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onDelete)}
            className="ui-menu-item ui-menu-item-danger flex w-full items-center rounded-lg px-3 py-2 text-left text-rose-300"
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}
