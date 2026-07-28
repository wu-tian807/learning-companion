import { describe, expect, it } from 'vitest';

import { resolveContextMenuViewportPosition } from './context-menu-position';

describe('Workbench context menu position', () => {
  it('keeps the menu within the current viewport', () => {
    expect(
      resolveContextMenuViewportPosition(900, 700, 1024, 768),
    ).toEqual({ x: 776, y: 420 });
    expect(
      resolveContextMenuViewportPosition(-20, -10, 1024, 768),
    ).toEqual({ x: 8, y: 8 });
  });
});
