export interface ImageMarkerPoint {
  readonly x: number;
  readonly y: number;
}

export interface ImageMarkerLayoutInput {
  readonly id: string;
  readonly preferredPosition: ImageMarkerPoint;
}

export interface ImageMarkerLayoutResult {
  readonly id: string;
  readonly position: ImageMarkerPoint;
}

export interface ImageMarkerViewport {
  readonly width: number;
  readonly height: number;
}

const MARKER_RADIUS = 9;
const MARKER_GAP = 4;
const MARKER_SPACING = MARKER_RADIUS * 2 + MARKER_GAP;

function isAvailable(
  candidate: ImageMarkerPoint,
  occupied: readonly ImageMarkerPoint[],
): boolean {
  return occupied.every(
    (position) =>
      Math.hypot(candidate.x - position.x, candidate.y - position.y) >=
      MARKER_SPACING,
  );
}

function clampToViewport(
  point: ImageMarkerPoint,
  viewport?: ImageMarkerViewport,
): ImageMarkerPoint {
  const maximumX = viewport
    ? Math.max(MARKER_RADIUS, viewport.width - MARKER_RADIUS)
    : Number.POSITIVE_INFINITY;
  const maximumY = viewport
    ? Math.max(MARKER_RADIUS, viewport.height - MARKER_RADIUS)
    : Number.POSITIVE_INFINITY;
  return {
    x: Math.min(maximumX, Math.max(MARKER_RADIUS, point.x)),
    y: Math.min(maximumY, Math.max(MARKER_RADIUS, point.y)),
  };
}

function candidatesAround(
  preferred: ImageMarkerPoint,
  maximumRing: number,
  viewport?: ImageMarkerViewport,
): readonly ImageMarkerPoint[] {
  const candidates: ImageMarkerPoint[] = [clampToViewport(preferred, viewport)];
  for (let ring = 1; ring <= maximumRing; ring += 1) {
    const offset = ring * MARKER_SPACING;
    for (const [x, y] of [
      [-offset, 0],
      [0, -offset],
      [offset, 0],
      [0, offset],
      [-offset, -offset],
      [offset, -offset],
      [-offset, offset],
      [offset, offset],
    ] as const) {
      const candidate = clampToViewport(
        { x: preferred.x + x, y: preferred.y + y },
        viewport,
      );
      if (!candidates.some((item) => item.x === candidate.x && item.y === candidate.y)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

export function layoutImageMarkerPositions(
  markers: readonly ImageMarkerLayoutInput[],
  viewport?: ImageMarkerViewport,
): readonly ImageMarkerLayoutResult[] {
  const occupied: ImageMarkerPoint[] = [];
  return markers.map(({ id, preferredPosition }) => {
    const candidates = candidatesAround(
      preferredPosition,
      markers.length + 1,
      viewport,
    );
    let position = candidates.find((candidate) =>
      isAvailable(candidate, occupied),
    );
    if (!position) {
      position = clampToViewport(preferredPosition, viewport);
      if (viewport) {
        for (
          let y = MARKER_RADIUS;
          !isAvailable(position, occupied) &&
          y <= viewport.height - MARKER_RADIUS;
          y += MARKER_SPACING
        ) {
          for (
            let x = MARKER_RADIUS;
            x <= viewport.width - MARKER_RADIUS;
            x += MARKER_SPACING
          ) {
            const candidate = { x, y };
            if (isAvailable(candidate, occupied)) {
              position = candidate;
              break;
            }
          }
        }
      } else {
        while (!isAvailable(position, occupied)) {
          position = { x: position.x + MARKER_SPACING, y: position.y };
        }
      }
    }
    occupied.push(position);
    return { id, position };
  });
}
