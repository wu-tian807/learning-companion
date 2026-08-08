import { formatRelativeTime } from '../project/relative-time';
import type { GenerationTaskPresentation } from './use-generation-tasks';

export interface GenerationTaskListItemProps {
  readonly presentation: GenerationTaskPresentation;
  readonly now: number;
  readonly onRetry?: (taskId: string) => Promise<void> | void;
  readonly onCancel?: (taskId: string) => Promise<void> | void;
}

export function GenerationTaskListItem({
  presentation,
  now,
  onRetry,
  onCancel,
}: GenerationTaskListItemProps) {
  const { task, statusLabel } = presentation;
  const failed = task.status === 'failed';

  return (
    <div
      data-generation-task-id={task.id}
      data-generation-task-status={task.status}
      title={task.id}
      className="my-0.5 grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[11px] border border-indigo-300/10 bg-indigo-500/[0.075] p-2.5 text-left"
    >
      <span className="grid size-[34px] place-items-center rounded-[9px] bg-indigo-300/[0.09] text-[9px] font-semibold text-indigo-100">
        脑图
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-slate-200">
          思维导图生成
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-slate-500">
          <span
            className={[
              'truncate',
              failed ? 'text-rose-300' : 'text-indigo-200/70',
            ].join(' ')}
            title={statusLabel}
          >
            {statusLabel}
          </span>
          <span className="shrink-0 text-slate-600">·</span>
          <span className="shrink-0">
            {formatRelativeTime(task.updatedTime, now)}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {failed && (
          <button
            type="button"
            aria-label="重试思维导图生成任务"
            className="ui-control rounded-full px-2.5 py-1 text-[9px] text-slate-300"
            onClick={() => {
              void onRetry?.(task.id);
            }}
          >
            重试
          </button>
        )}
        <button
          type="button"
          aria-label="取消思维导图生成任务"
          className="ui-control rounded-full px-2.5 py-1 text-[9px] text-slate-500"
          onClick={() => {
            void onCancel?.(task.id);
          }}
        >
          取消
        </button>
      </span>
    </div>
  );
}
