import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { observeOutsideContextMenuPointer } from './context-menu-dismissal';
import { WorkbenchContextMenuDismissLayer } from './WorkbenchContextMenuHost';

describe('observeOutsideContextMenuPointer', () => {
  it('observes pointerdown in capture phase and dismisses only outside pointers', () => {
    let listener: ((event: PointerEvent) => void) | undefined;
    const addEventListener = vi.fn(
      (_type: string, candidate: EventListenerOrEventListenerObject) => {
        listener = candidate as (event: PointerEvent) => void;
      },
    );
    const removeEventListener = vi.fn();
    const documentTarget = {
      addEventListener,
      removeEventListener,
    } as unknown as Document;
    const menuChild = {} as Node;
    const outside = {} as Node;
    const menuRoot = {
      contains: vi.fn((target: Node | null) => target === menuChild),
    } as unknown as HTMLElement;
    const onDismiss = vi.fn();

    const stop = observeOutsideContextMenuPointer(
      documentTarget,
      () => menuRoot,
      onDismiss,
    );

    expect(addEventListener).toHaveBeenCalledWith(
      'pointerdown',
      expect.any(Function),
      true,
    );
    listener?.({ target: menuChild } as unknown as PointerEvent);
    expect(onDismiss).not.toHaveBeenCalled();

    listener?.({ target: outside } as unknown as PointerEvent);
    expect(onDismiss).toHaveBeenCalledOnce();

    stop();
    expect(removeEventListener).toHaveBeenCalledWith(
      'pointerdown',
      listener,
      true,
    );
  });
});

describe('WorkbenchContextMenuDismissLayer', () => {
  it('captures the pointer and dismisses the context menu', () => {
    const onDismiss = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const layer = WorkbenchContextMenuDismissLayer({ onDismiss });
    const onPointerDown = (
      layer.props as {
        readonly onPointerDown: (event: {
          preventDefault(): void;
          stopPropagation(): void;
        }) => void;
      }
    ).onPointerDown;

    onPointerDown({ preventDefault, stopPropagation });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();

    const markup = renderToStaticMarkup(layer);
    expect(markup).toContain(
      'data-workbench-context-menu-dismiss-layer="true"',
    );
    expect(markup).toContain('fixed inset-0 z-[89]');
  });
});
