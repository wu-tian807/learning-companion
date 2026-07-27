import type { ProjectSnapshot } from '../../shared/projects';
import { formatAssetCount, formatProjectDate } from '../project-view';
import {
  ProjectActionsMenu,
  type ProjectActionHandlers,
} from './ProjectActionsMenu';

interface ProjectListProps extends ProjectActionHandlers {
  projects: readonly ProjectSnapshot[];
  onOpenProject: (project: ProjectSnapshot) => void;
  actionsDisabled?: boolean;
}

export function ProjectList({
  projects,
  onOpenProject,
  actionsDisabled = false,
  onRename,
  onTogglePinned,
  onDelete,
}: ProjectListProps) {
  return (
    <section aria-label="Project 列表视图" className="w-full">
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[52%]" />
          <col className="w-[18%]" />
          <col className="w-[23%]" />
          <col className="w-[7%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-white/[0.13] text-xs text-slate-400">
            <th scope="col" className="px-4 py-4 font-medium">
              标题
            </th>
            <th scope="col" className="px-4 py-4 font-medium">
              来源
            </th>
            <th scope="col" className="px-4 py-4 font-medium">
              创建时间
            </th>
            <th scope="col" className="px-2 py-4 text-right font-medium">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr
              key={project.id}
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
              className="cursor-pointer border-b border-white/[0.1] text-sm text-slate-200 transition hover:bg-white/[0.04] focus-visible:bg-indigo-300/[0.06] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-300"
            >
              <td className="px-4 py-[15px]">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-xl leading-none">{project.icon}</span>
                  <span className="truncate font-medium">{project.name}</span>
                  {project.pinned && (
                    <span className="shrink-0 rounded-full bg-indigo-300/10 px-2 py-0.5 text-[10px] text-indigo-200/75">
                      置顶
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-[15px] text-slate-400">
                {formatAssetCount(project.assetCount)}
              </td>
              <td className="px-4 py-[15px] text-slate-400">
                {formatProjectDate(project.createdTime)}
              </td>
              <td className="px-2 py-[10px]">
                <div className="flex justify-end">
                  <ProjectActionsMenu
                    project={project}
                    disabled={actionsDisabled}
                    onRename={onRename}
                    onTogglePinned={onTogglePinned}
                    onDelete={onDelete}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
