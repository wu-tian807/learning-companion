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

function clampToTopLeftEdges(point: ImageMarkerPoint): ImageMarkerPoint {
  return {
    x: Math.max(MARKER_RADIUS, point.x),
    y: Math.max(MARKER_RADIUS, point.y),
  };
}

function candidatesAround(
  preferred: ImageMarkerPoint,
  maximumRing: number,
): readonly ImageMarkerPoint[] {
  const candidates: ImageMarkerPoint[] = [clampToTopLeftEdges(preferred)];
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
      const candidate = clampToTopLeftEdges({
        x: preferred.x + x,
        y: preferred.y + y,
      });
      if (!candidates.some((item) => item.x === candidate.x && item.y === candidate.y)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

export function layoutImageMarkerPositions(
  markers: readonly ImageMarkerLayoutInput[],
): readonly ImageMarkerLayoutResult[] {
  const occupied: ImageMarkerPoint[] = [];
  return markers.map(({ id, preferredPosition }) => {
    const candidates = candidatesAround(preferredPosition, markers.length + 1);
    let position = candidates.find((candidate) =>
      isAvailable(candidate, occupied),
    );
    if (!position) {
      position = clampToTopLeftEdges(preferredPosition);
      while (!isAvailable(position, occupied)) {
        position = { x: position.x + MARKER_SPACING, y: position.y };
      }
    }
    occupied.push(position);
    return { id, position };
  });
}
