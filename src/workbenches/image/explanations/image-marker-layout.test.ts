import { describe, expect, it } from 'vitest';

import { layoutImageMarkerPositions } from './image-marker-layout';

describe('layoutImageMarkerPositions', () => {
  it('keeps separated marker badges at their preferred positions', () => {
    expect(layoutImageMarkerPositions([
      { id: 'one', preferredPosition: { x: 20, y: 20 } },
      { id: 'two', preferredPosition: { x: 80, y: 80 } },
    ])).toEqual([
      { id: 'one', position: { x: 20, y: 20 } },
      { id: 'two', position: { x: 80, y: 80 } },
    ]);
  });

  it('moves colliding badges deterministically while keeping every badge distinct', () => {
    const layout = layoutImageMarkerPositions([
      { id: 'one', preferredPosition: { x: 20, y: 20 } },
      { id: 'two', preferredPosition: { x: 20, y: 20 } },
      { id: 'three', preferredPosition: { x: 21, y: 21 } },
    ]);
    expect(layout[0]?.position).toEqual({ x: 20, y: 20 });
    expect(new Set(layout.map(({ position }) => `${position.x},${position.y}`))).toHaveLength(3);
    for (let index = 0; index < layout.length; index += 1) {
      for (let other = index + 1; other < layout.length; other += 1) {
        const left = layout[index]!.position;
        const right = layout[other]!.position;
        expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThanOrEqual(22);
      }
    }
    expect(layoutImageMarkerPositions([
      { id: 'one', preferredPosition: { x: 20, y: 20 } },
      { id: 'two', preferredPosition: { x: 20, y: 20 } },
      { id: 'three', preferredPosition: { x: 21, y: 21 } },
    ])).toEqual(layout);
  });

  it('keeps badge centers inside the top and left overlay edges', () => {
    expect(layoutImageMarkerPositions([
      { id: 'edge', preferredPosition: { x: 0, y: 2 } },
    ])).toEqual([{ id: 'edge', position: { x: 9, y: 9 } }]);
  });
});
