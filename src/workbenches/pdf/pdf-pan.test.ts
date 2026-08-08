import { describe, expect, it } from 'vitest';

import {
  calculatePdfPanScroll,
  canStartPdfPan,
  hasPdfHorizontalOverflow,
} from './pdf-pan';

describe('PDF pointer panning', () => {
  it('only starts a primary left-button drag on a horizontally zoomed canvas', () => {
    const base = {
      button: 0,
      isPrimary: true,
      scrollWidth: 1_200,
      clientWidth: 800,
      blockedTarget: false,
    };

    expect(canStartPdfPan(base)).toBe(true);
    expect(canStartPdfPan({ ...base, button: 2 })).toBe(false);
    expect(canStartPdfPan({ ...base, isPrimary: false })).toBe(false);
    expect(canStartPdfPan({ ...base, blockedTarget: true })).toBe(false);
    expect(
      canStartPdfPan({ ...base, scrollWidth: 800 }),
    ).toBe(false);
    expect(hasPdfHorizontalOverflow(802, 800)).toBe(true);
  });

  it('moves the viewport opposite to the pointer delta', () => {
    expect(
      calculatePdfPanScroll(
        {
          clientX: 100,
          clientY: 80,
          scrollLeft: 500,
          scrollTop: 300,
        },
        140,
        60,
      ),
    ).toEqual({ left: 460, top: 320 });
  });
});
