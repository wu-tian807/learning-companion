import type { ProjectSnapshot } from '../../shared/projects';
import { formatAssetCount, formatProjectDate, getProjectCardColor } from '../project-view';
import {
  ProjectActionsMenu,
  type ProjectActionHandlers,
} from './ProjectActionsMenu';

interface ProjectGridProps extends ProjectActionHandlers {
  projects: readonly ProjectSnapshot[];
  onOpenProject: (project: ProjectSnapshot) => void;
  actionsDisabled?: boolean;
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="m5.2 2.5 5.3 5.3M6.6 1.9l5.5 5.5-2 1.1-1.6 3.1-1.3-1.3-3.6 3.6-.7-.7 3.6-3.6-1.3-1.3 3.1-1.6 1.1-2Z" />
    </svg>
  );
}

export function ProjectGrid({
  projects,
  onOpenProject,
  actionsDisabled = false,
  onRename,
  onTogglePinned,
  onDelete,
}: ProjectGridProps) {
  return (
    <section
      aria-label="Project 舒展视图"
      className="grid grid-cols-[repeat(auto-fill,minmax(245px,1fr))] gap-4"
    >
      {projects.map((project) => (
        <article
          key={project.id}
          role="button"
          tabIndex={0}
          aria-label={`打开 ${project.name}`}
          onClick={() => onOpenProject(project)}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === 'Enter' || event.key === ' ')
            ) {
              event.preventDefault();
              onOpenProject(project);
            }
          }}
          className="group relative flex min-h-[230px] cursor-pointer flex-col justify-between rounded-[17px] border border-white/[0.04] p-6 shadow-[0_10px_28px_rgba(7,9,12,0.08)] transition duration-150 hover:-translate-y-0.5 hover:border-indigo-200/20 hover:shadow-[0_18px_40px_rgba(7,9,12,0.2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
          style={{ backgroundColor: getProjectCardColor(project.id) }}
        >
          <div className="flex items-start justify-between gap-4">
            <span className="text-[43px] leading-none drop-shadow-[0_6px_10px_rgba(0,0,0,0.16)]">
              {project.icon}
            </span>
            <ProjectActionsMenu
              project={project}
              disabled={actionsDisabled}
              onRename={onRename}
              onTogglePinned={onTogglePinned}
              onDelete={onDelete}
            />
          </div>

          <div>
            {project.pinned && (
              <span className="mb-3 inline-flex items-center gap-1 rounded-full bg-black/15 px-2 py-1 text-[10px] font-medium text-indigo-100/75">
                <span className="size-3">
                  <PinIcon />
                </span>
                已置顶
              </span>
            )}
            <h2 className="mb-2 line-clamp-2 text-[19px] leading-[1.35] font-medium text-slate-100">
              {project.name}
            </h2>
            <p className="text-xs text-slate-300/75">
              {formatProjectDate(project.createdTime)} ·{' '}
              {formatAssetCount(project.assetCount)}
            </p>
          </div>
        </article>
      ))}
    </section>
  );
}
