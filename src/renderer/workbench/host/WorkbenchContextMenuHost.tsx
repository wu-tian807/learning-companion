import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import type { ResolvedWorkbenchContribution } from '../runtime/workbench-action-registry';
import {
  useWorkbenchRuntime,
  useWorkbenchRuntimeSelector,
} from '../runtime/workbench-runtime-context';
import { WorkbenchMenu } from '../ui/WorkbenchMenu';
import {
  type ContextMenuSize,
  type ContextMenuViewport,
  resolveContextMenuMaximumHeight,
  resolveContextMenuViewportPosition,
} from './context-menu-position';
import { observeOutsideContextMenuPointer } from './context-menu-dismissal';

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

export function WorkbenchContextMenuDismissLayer({
  onDismiss,
}: {
  readonly onDismiss: () => void;
}) {
  const dismiss = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  };

  return (
    <div
      aria-hidden="true"
      data-workbench-context-menu-dismiss-layer="true"
      className="fixed inset-0 z-[89]"
      onPointerDown={dismiss}
    />
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
  const [menuSize, setMenuSize] = useState<ContextMenuSize>({
    width: 0,
    height: 0,
  });
  const entries = runtime.contributions('context-menu');
  void revision;

  useLayoutEffect(() => {
    if (!contextMenu) {
      return;
    }

    const root = rootRef.current;

    if (!root) {
      return;
    }

    const measure = () => {
      const bounds = root.getBoundingClientRect();

      setMenuSize((current) => {
        if (
          current.width === bounds.width &&
          current.height === bounds.height
        ) {
          return current;
        }

        return {
          width: bounds.width,
          height: bounds.height,
        };
      });
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);

    return () => resizeObserver.disconnect();
  }, [contextMenu, revision]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const stopObservingOutsidePointer = observeOutsideContextMenuPointer(
      document,
      () => rootRef.current,
      () => runtime.closeContextMenu(),
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        runtime.closeContextMenu();
      }
    };
    const closeOnViewportChange = () => runtime.closeContextMenu();

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('scroll', closeOnViewportChange, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', closeOnViewportChange);
    window.visualViewport?.addEventListener(
      'resize',
      closeOnViewportChange,
    );
    window.visualViewport?.addEventListener(
      'scroll',
      closeOnViewportChange,
    );

    return () => {
      stopObservingOutsidePointer();
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener(
        'scroll',
        closeOnViewportChange,
        true,
      );
      window.removeEventListener('resize', closeOnViewportChange);
      window.visualViewport?.removeEventListener(
        'resize',
        closeOnViewportChange,
      );
      window.visualViewport?.removeEventListener(
        'scroll',
        closeOnViewportChange,
      );
    };
  }, [contextMenu, runtime]);

  if (
    !contextMenu ||
    entries.length === 0 ||
    typeof document === 'undefined'
  ) {
    return null;
  }

  const visualViewport = window.visualViewport;
  const viewport: ContextMenuViewport = visualViewport
    ? {
        left: visualViewport.offsetLeft,
        top: visualViewport.offsetTop,
        width: visualViewport.width,
        height: visualViewport.height,
      }
    : {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
  const position = resolveContextMenuViewportPosition(
    contextMenu.x,
    contextMenu.y,
    menuSize,
    viewport,
  );

  return createPortal(
    <>
      {contextMenu.captureOutsidePointer ? (
        <WorkbenchContextMenuDismissLayer
          onDismiss={() => runtime.closeContextMenu()}
        />
      ) : null}
      <WorkbenchMenu
        rootRef={rootRef}
        ariaLabel="工作台右键菜单"
        entries={entries}
        busyActionIds={busyActionIds}
        onWheel={(event) => {
          const root = rootRef.current;

          if (root && root.scrollHeight > root.clientHeight) {
            event.stopPropagation();
            return;
          }

          if (contextMenu.onWheel) {
            event.preventDefault();
            contextMenu.onWheel({
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              deltaMode: event.deltaMode,
            });
          }
          runtime.closeContextMenu();
        }}
        onInvoke={(entry) => {
          void runtime
            .invoke(entry.action.id, contextMenu.invocation)
            .then((result) => {
              if (shouldClose(entry, result)) {
                runtime.closeContextMenu();
              }
            });
        }}
        className="fixed z-[90] overflow-y-auto overscroll-contain"
        style={{
          left: position.x,
          top: position.y,
          maxHeight: resolveContextMenuMaximumHeight(viewport),
        }}
      />
    </>,
    document.body,
  );
}
