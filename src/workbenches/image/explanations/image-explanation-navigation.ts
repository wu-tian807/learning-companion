import type { ImageRegionTarget } from './shared';

export interface ImageExplanationLocationItem<Bounds> {
  imageToViewportRectangle(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Bounds;
}

export interface ImageExplanationLocationViewport<Bounds> {
  fitBoundsWithConstraints(bounds: Bounds, immediately?: boolean): void;
}

export function displayImageExplanationLocation<Bounds>(
  item: ImageExplanationLocationItem<Bounds>,
  viewport: ImageExplanationLocationViewport<Bounds>,
  target: ImageRegionTarget,
): void {
  const region = target.anchorPayload;
  const paddingX = Math.max(region.width * 0.35, 0.015);
  const paddingY = Math.max(region.height * 0.35, 0.015);
  const left = Math.max(0, region.x - paddingX);
  const top = Math.max(0, region.y - paddingY);
  const right = Math.min(1, region.x + region.width + paddingX);
  const bottom = Math.min(1, region.y + region.height + paddingY);
  const bounds = item.imageToViewportRectangle(
    left * region.sourceWidth,
    top * region.sourceHeight,
    (right - left) * region.sourceWidth,
    (bottom - top) * region.sourceHeight,
  );
  viewport.fitBoundsWithConstraints(bounds, false);
}
