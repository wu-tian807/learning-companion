import type { CSSProperties, Ref } from 'react';

import type { ResolvedWorkbenchContribution } from '../runtime/workbench-action-registry';
import {
  formatWorkbenchShortcut,
  groupWorkbenchMenuEntries,
} from './workbench-menu-model';

export interface WorkbenchMenuProps {
  readonly ariaLabel: string;
  readonly entries: readonly ResolvedWorkbenchContribution[];
  readonly busyActionIds: ReadonlySet<string>;
  readonly onInvoke: (
    entry: ResolvedWorkbenchContribution,
  ) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly rootRef?: Ref<HTMLDivElement>;
}

function entryRole(
  entry: ResolvedWorkbenchContribution,
): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' {
  if (entry.contribution.presentation.kind === 'checkbox') {
    return 'menuitemcheckbox';
  }
  if (entry.contribution.presentation.kind === 'radio') {
    return 'menuitemradio';
  }
  return 'menuitem';
}

export function WorkbenchMenu({
  ariaLabel,
  entries,
  busyActionIds,
  onInvoke,
  className = '',
  style,
  rootRef,
}: WorkbenchMenuProps) {
  const groups = groupWorkbenchMenuEntries(entries);
  const itemClass =
    'ui-menu-item flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={ariaLabel}
      style={style}
      className={[
        'w-60 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.5)]',
        className,
      ].join(' ')}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.id}>
          {groupIndex > 0 && (
            <div className="my-1 h-px bg-white/[0.08]" />
          )}
          {group.label && (
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-slate-500">
              {group.label}
            </p>
          )}
          {group.entries.map((entry) => {
            const presentation = entry.contribution.presentation;
            const busy = busyActionIds.has(entry.action.id);
            const disabled = !entry.action.enabled || busy;
            const checked =
              presentation.kind === 'checkbox' ||
              presentation.kind === 'radio'
                ? presentation.checked
                : undefined;

            return (
              <button
                key={`${entry.ownerId}:${entry.contribution.id}`}
                type="button"
                role={entryRole(entry)}
                aria-checked={checked}
                disabled={disabled}
                title={
                  disabled
                    ? presentation.disabledReason
                    : presentation.description
                }
                onClick={() => onInvoke(entry)}
                className={itemClass}
              >
                <span>{presentation.label}</span>
                {presentation.shortcut ? (
                  <span className="shrink-0 text-slate-500">
                    {formatWorkbenchShortcut(
                      presentation.shortcut,
                    )}
                  </span>
                ) : checked !== undefined ? (
                  <span
                    className={
                      checked
                        ? 'text-indigo-200'
                        : 'text-transparent'
                    }
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
