import { useEffect, useRef, useState } from 'react';

import { WorkbenchMenu } from '../ui/WorkbenchMenu';
import type { ResolvedWorkbenchContribution } from '../runtime/workbench-action-registry';
import {
  useWorkbenchRuntime,
  useWorkbenchRuntimeSelector,
} from '../runtime/workbench-runtime-context';

function shouldClose(
  entry: ResolvedWorkbenchContribution,
  result: string,
): boolean {
  const policy =
    entry.contribution.presentation.closePolicy ?? 'on-success';

  return (
    policy === 'always' ||
    (policy === 'on-success' && result === 'executed')
  );
}

export function WorkbenchOverflowHost() {
  const runtime = useWorkbenchRuntime();
  const revision = useWorkbenchRuntimeSelector(
    (state) => state.contributionRevision,
  );
  const busyActionIds = useWorkbenchRuntimeSelector(
    (state) => state.busyActionIds,
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const entries = runtime.contributions('overflow');
  void revision;

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
    const closeOnResize = () => setOpen(false);

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnResize);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [open]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="工作台选项"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="ui-icon-button grid h-[26px] min-w-[32px] place-items-center rounded-lg border border-white/[0.08] px-2 text-xs tracking-[0.1em] text-slate-400"
        title="工作台选项"
      >
        •••
      </button>
      {open && (
        <WorkbenchMenu
          ariaLabel="工作台选项"
          entries={entries}
          busyActionIds={busyActionIds}
          onInvoke={(entry) => {
            void runtime
              .invokeCurrent(entry.action.id, 'overflow')
              .then((result) => {
                if (shouldClose(entry, result)) {
                  setOpen(false);
                }
              });
          }}
          className="absolute top-8 right-0 z-50"
        />
      )}
    </div>
  );
}
