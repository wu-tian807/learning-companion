import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchContextMenuDismissLayer } from './WorkbenchContextMenuHost';

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
