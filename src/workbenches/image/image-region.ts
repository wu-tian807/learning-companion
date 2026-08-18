import {
  createImageRegionTarget,
  type ImageRegionTarget,
} from './shared';

export interface ImagePoint {
  readonly x: number;
  readonly y: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Converts a screen selection's image-space corners into a canonical source-image rectangle. */
export function createImageRegionFromImagePoints(
  points: readonly ImagePoint[],
  sourceWidth: number,
  sourceHeight: number,
): ImageRegionTarget | undefined {
  if (
    points.length < 2 ||
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
  ) {
    return undefined;
  }

  const left = clamp(Math.min(...points.map((point) => point.x)), 0, sourceWidth);
  const top = clamp(Math.min(...points.map((point) => point.y)), 0, sourceHeight);
  const right = clamp(Math.max(...points.map((point) => point.x)), 0, sourceWidth);
  const bottom = clamp(Math.max(...points.map((point) => point.y)), 0, sourceHeight);
  if (right - left < 1 || bottom - top < 1) return undefined;

  return createImageRegionTarget({
    x: left / sourceWidth,
    y: top / sourceHeight,
    width: (right - left) / sourceWidth,
    height: (bottom - top) / sourceHeight,
    sourceWidth,
    sourceHeight,
  });
}
