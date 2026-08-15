export interface PdfRegionPointState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly currentX: number;
  readonly currentY: number;
}

export interface PdfRegionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export function movePdfRegionPointer<T extends PdfRegionPointState>(
  state: T, pointerId: number, clientX: number, clientY: number,
): T | undefined {
  if (state.pointerId !== pointerId) return undefined;
  return { ...state, currentX: clientX, currentY: clientY };
}

export function completePdfRegionPointer(
  state: PdfRegionPointState,
  pointerId: number,
  clientX: number,
  clientY: number,
  page: PdfRegionRect,
  minimumSize = 8,
) {
  if (state.pointerId !== pointerId) return undefined;
  const left = Math.max(page.left, Math.min(state.startX, clientX));
  const top = Math.max(page.top, Math.min(state.startY, clientY));
  const right = Math.min(page.right, Math.max(state.startX, clientX));
  const bottom = Math.min(page.bottom, Math.max(state.startY, clientY));
  if (right - left < minimumSize || bottom - top < minimumSize) {
    return { kind: 'too-small' as const };
  }
  return {
    kind: 'complete' as const,
    x: (left - page.left) / page.width,
    y: (top - page.top) / page.height,
    width: (right - left) / page.width,
    height: (bottom - top) / page.height,
    top,
  };
}

export function shouldDismissPdfRegionMenu(
  menu: { contains(target: unknown): boolean } | null,
  target: unknown,
): boolean {
  return menu !== null && !menu.contains(target);
}
