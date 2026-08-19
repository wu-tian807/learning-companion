import { describe, expect, it } from 'vitest';

import { createImageRegionFromImagePoints } from './image-region';

describe('image interest-region coordinates', () => {
  it('normalizes and clamps rotated screen corners in source-image space', () => {
    const target = createImageRegionFromImagePoints(
      [
        { x: 900, y: 100 },
        { x: 1100, y: 200 },
        { x: 1000, y: 500 },
        { x: 800, y: 400 },
      ],
      1000,
      500,
    );
    expect(target?.anchorPayload).toEqual({
      x: 0.8,
      y: 0.2,
      width: 0.2,
      height: 0.8,
      sourceWidth: 1000,
      sourceHeight: 500,
    });
  });

  it('rejects degenerate or invalid selections', () => {
    expect(createImageRegionFromImagePoints([{ x: 1, y: 1 }], 100, 100)).toBeUndefined();
    expect(createImageRegionFromImagePoints([{ x: 1, y: 1 }, { x: 1.5, y: 1.5 }], 100, 100)).toBeUndefined();
    expect(createImageRegionFromImagePoints([{ x: 1, y: 1 }, { x: 5, y: 5 }], 0, 100)).toBeUndefined();
  });
});
