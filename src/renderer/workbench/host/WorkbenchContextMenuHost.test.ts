import { describe, expect, it } from 'vitest';

import {
  resolveContextMenuMaximumHeight,
  resolveContextMenuViewportPosition,
} from './context-menu-position';

describe('Workbench context menu position', () => {
  const viewport = {
    left: 0,
    top: 0,
    width: 1024,
    height: 768,
  };
  const menuSize = {
    width: 240,
    height: 340,
  };

  it('keeps the measured menu within the current viewport', () => {
    expect(
      resolveContextMenuViewportPosition(
        900,
        700,
        menuSize,
        viewport,
      ),
    ).toEqual({ x: 776, y: 420 });
    expect(
      resolveContextMenuViewportPosition(
        -20,
        -10,
        menuSize,
        viewport,
      ),
    ).toEqual({ x: 8, y: 8 });
  });

  it('accounts for an offset visual viewport', () => {
    expect(
      resolveContextMenuViewportPosition(
        900,
        700,
        menuSize,
        {
          left: 12,
          top: 30,
          width: 800,
          height: 600,
        },
      ),
    ).toEqual({ x: 564, y: 282 });
  });

  it('pins an oversized menu to the viewport margin', () => {
    expect(
      resolveContextMenuViewportPosition(
        160,
        120,
        {
          width: 400,
          height: 500,
        },
        {
          left: 0,
          top: 0,
          width: 320,
          height: 240,
        },
      ),
    ).toEqual({ x: 8, y: 8 });
  });

  it('reserves equal top and bottom margins for menu scrolling', () => {
    expect(resolveContextMenuMaximumHeight(viewport)).toBe(752);
  });
});
