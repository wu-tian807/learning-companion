import { describe, expect, it, vi } from 'vitest';

import { createImageRegionTarget } from '../shared';
import {
  displayImageExplanationLocation,
  imageExplanationMarkerPosition,
} from './image-explanation-navigation';

describe('displayImageExplanationLocation', () => {
  it('places the number badge on the selection top-left corner instead of its center', () => {
    const imageToViewportCoordinates = vi.fn((x: number, y: number) => ({ x, y }));
    const pixelFromPoint = vi.fn((point: { x: number; y: number }) => ({
      x: point.x + 5,
      y: point.y + 10,
    }));
    const position = imageExplanationMarkerPosition(
      { imageToViewportCoordinates },
      { pixelFromPoint },
      createImageRegionTarget({ x: 0.1, y: 0.2, width: 0.3, height: 0.4, sourceWidth: 1000, sourceHeight: 800 }),
    );
    expect(imageToViewportCoordinates).toHaveBeenCalledWith(100, 160);
    expect(pixelFromPoint).toHaveBeenCalledWith({ x: 100, y: 160 }, true);
    expect(position).toEqual({ x: 105, y: 170 });
  });

  it('adds context padding and fits the viewport to the image region', () => {
    const bounds = { id: 'viewport-bounds' };
    const imageToViewportRectangle = vi.fn(
      (x: number, y: number, width: number, height: number) => {
        void [x, y, width, height];
        return bounds;
      },
    );
    const fitBoundsWithConstraints = vi.fn();
    displayImageExplanationLocation(
      { imageToViewportRectangle },
      { fitBoundsWithConstraints },
      createImageRegionTarget({ x: 0.2, y: 0.25, width: 0.2, height: 0.25, sourceWidth: 1000, sourceHeight: 800 }),
    );
    const coordinates = imageToViewportRectangle.mock.calls[0];
    expect(coordinates?.[0]).toBeCloseTo(130);
    expect(coordinates?.[1]).toBeCloseTo(130);
    expect(coordinates?.[2]).toBeCloseTo(340);
    expect(coordinates?.[3]).toBeCloseTo(340);
    expect(fitBoundsWithConstraints).toHaveBeenCalledWith(bounds, false);
  });

  it('clamps location padding at image edges', () => {
    const imageToViewportRectangle = vi.fn(
      (x: number, y: number, width: number, height: number) => {
        void [x, y, width, height];
        return 'bounds';
      },
    );
    const fitBoundsWithConstraints = vi.fn();
    displayImageExplanationLocation(
      { imageToViewportRectangle },
      { fitBoundsWithConstraints },
      createImageRegionTarget({ x: 0, y: 0, width: 0.1, height: 0.1, sourceWidth: 200, sourceHeight: 100 }),
    );
    expect(imageToViewportRectangle).toHaveBeenCalledWith(0, 0, 27, 13.5);
  });
});
