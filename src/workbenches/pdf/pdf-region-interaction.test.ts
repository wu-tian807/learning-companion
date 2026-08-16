import { describe, expect, it, vi } from 'vitest';
import {
  completePdfRegionPointer,
  movePdfRegionPointer,
  shouldDismissPdfRegionMenu,
  shouldDismissPdfRegionSelection,
} from './pdf-region-interaction';

describe('PDF region pointer lifecycle', () => {
  const state = { pointerId: 7, startX: 20, startY: 30, currentX: 20, currentY: 30 };
  const page = { left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100 };

  it('moves and completes only the captured pointer, clipped to the page', () => {
    expect(movePdfRegionPointer(state, 8, 100, 90)).toBeUndefined();
    expect(movePdfRegionPointer(state, 7, 100, 90)).toMatchObject({ currentX: 100, currentY: 90 });
    expect(completePdfRegionPointer(state, 8, 300, 200, page)).toBeUndefined();
    expect(completePdfRegionPointer(state, 7, 300, 200, page)).toEqual({
      kind: 'complete', x: 0.05, y: 0.2, width: 0.95, height: 0.8, top: 30,
    });
  });

  it('rejects tiny selections and allows a fresh selection afterwards', () => {
    expect(completePdfRegionPointer(state, 7, 24, 34, page)).toEqual({ kind: 'too-small' });
    const next = { ...state, pointerId: 9, startX: 50, startY: 40 };
    expect(completePdfRegionPointer(next, 9, 100, 80, page)).toMatchObject({ kind: 'complete' });
  });

  it('dismisses the quick menu only for an outside target', () => {
    const menu = { contains: vi.fn((target) => target === 'inside') };
    expect(shouldDismissPdfRegionMenu(menu, 'inside')).toBe(false);
    expect(shouldDismissPdfRegionMenu(menu, 'outside')).toBe(true);
    expect(shouldDismissPdfRegionMenu(null, 'outside')).toBe(false);
  });

  it('dismisses a completed region only when clicking blank canvas outside it', () => {
    const selection = { left: 20, top: 30, width: 100, height: 60 };
    const menu = { contains: vi.fn((target) => target === 'menu') };
    expect(shouldDismissPdfRegionSelection({
      menu, target: 'menu', selection, point: { x: 200, y: 200 },
    })).toBe(false);
    expect(shouldDismissPdfRegionSelection({
      menu, target: 'page', selection, point: { x: 50, y: 50 },
    })).toBe(false);
    expect(shouldDismissPdfRegionSelection({
      menu, target: 'page', selection, point: { x: 200, y: 200 },
    })).toBe(true);
  });
});
