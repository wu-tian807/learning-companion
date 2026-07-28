import {
  useEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';

import type { ResolvedWorkbenchContribution } from '../runtime/workbench-action-registry';
import {
  useWorkbenchRuntime,
  useWorkbenchRuntimeSelector,
} from '../runtime/workbench-runtime-context';
import { WorkbenchMenu } from '../ui/WorkbenchMenu';
import { resolveContextMenuViewportPosition } from './context-menu-position';

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

export function WorkbenchContextMenuHost() {
  const runtime = useWorkbenchRuntime();
  const contextMenu = useWorkbenchRuntimeSelector(
    (state) => state.contextMenu,
  );
  const revision = useWorkbenchRuntimeSelector(
    (state) => state.contributionRevision,
  );
  const busyActionIds = useWorkbenchRuntimeSelector(
    (state) => state.busyActionIds,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const entries = runtime.contributions('context-menu');
  void revision;

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        runtime.closeContextMenu();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        runtime.closeContextMenu();
      }
    };
    const closeOnViewportChange = () => runtime.closeContextMenu();

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeOnViewportChange, {
      passive: true,
    });
    window.addEventListener('resize', closeOnViewportChange);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', closeOnViewportChange);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [contextMenu, runtime]);

  if (
    !contextMenu ||
    entries.length === 0 ||
    typeof document === 'undefined'
  ) {
    return null;
  }

  const position = resolveContextMenuViewportPosition(
    contextMenu.x,
    contextMenu.y,
    window.innerWidth,
    window.innerHeight,
  );

  return createPortal(
    <WorkbenchMenu
      rootRef={rootRef}
      ariaLabel="工作台右键菜单"
      entries={entries}
      busyActionIds={busyActionIds}
      onInvoke={(entry) => {
        void runtime
          .invoke(entry.action.id, contextMenu.invocation)
          .then((result) => {
            if (shouldClose(entry, result)) {
              runtime.closeContextMenu();
            }
          });
      }}
      className="fixed z-[90]"
      style={{
        left: position.x,
        top: position.y,
      }}
    />,
    document.body,
  );
}
