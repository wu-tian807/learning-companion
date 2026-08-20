import { isWorkbenchActionEnabled } from '../actions/workbench-action';
import {
  useWorkbenchRuntime,
  useWorkbenchRuntimeSelector,
} from '../runtime/workbench-runtime-context';

export function WorkbenchHeaderActionsHost() {
  const runtime = useWorkbenchRuntime();
  const revision = useWorkbenchRuntimeSelector(
    (state) => state.contributionRevision,
  );
  const busyActionIds = useWorkbenchRuntimeSelector(
    (state) => state.busyActionIds,
  );
  const entries = runtime.contributions('header');
  void revision;

  if (entries.length === 0) return null;

  return (
    <div
      aria-label="工作台快捷操作"
      className="flex shrink-0 items-center gap-1.5"
    >
      {entries.map((entry) => {
        const presentation = entry.contribution.presentation;
        const checked =
          presentation.kind === 'checkbox' ||
          presentation.kind === 'radio'
            ? presentation.checked
            : undefined;
        const busy = busyActionIds.has(entry.action.id);
        const disabled =
          busy || !isWorkbenchActionEnabled(entry.action);
        const accent =
          presentation.tone === 'accent' ||
          checked ||
          presentation.expanded;

        return (
          <button
            key={`${entry.ownerId}:${entry.contribution.id}`}
            type="button"
            aria-label={presentation.ariaLabel}
            aria-expanded={presentation.expanded}
            aria-pressed={checked}
            disabled={disabled}
            title={
              disabled
                ? presentation.disabledReason
                : presentation.description
            }
            onClick={() => {
              void runtime.invokeCurrent(entry.action.id, 'header');
            }}
            className={[
              'ui-control h-8 rounded-lg border px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-40',
              accent
                ? 'border-indigo-300/25 bg-indigo-400/10 text-indigo-200'
                : 'border-white/[0.09] text-slate-300',
            ].join(' ')}
          >
            {presentation.label}
            {presentation.badge !== undefined && (
              <span className="ml-1 tabular-nums opacity-60">
                {presentation.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
