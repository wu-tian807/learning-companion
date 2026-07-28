export interface ContextMenuViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ContextMenuSize {
  readonly width: number;
  readonly height: number;
}

export const CONTEXT_MENU_VIEWPORT_MARGIN = 8;

export function resolveContextMenuViewportPosition(
  x: number,
  y: number,
  menuSize: ContextMenuSize,
  viewport: ContextMenuViewport,
): { x: number; y: number } {
  const minimumX =
    viewport.left + CONTEXT_MENU_VIEWPORT_MARGIN;
  const minimumY =
    viewport.top + CONTEXT_MENU_VIEWPORT_MARGIN;
  const maximumX = Math.max(
    minimumX,
    viewport.left +
      viewport.width -
      menuSize.width -
      CONTEXT_MENU_VIEWPORT_MARGIN,
  );
  const maximumY = Math.max(
    minimumY,
    viewport.top +
      viewport.height -
      menuSize.height -
      CONTEXT_MENU_VIEWPORT_MARGIN,
  );

  return {
    x: Math.max(minimumX, Math.min(x, maximumX)),
    y: Math.max(minimumY, Math.min(y, maximumY)),
  };
}

export function resolveContextMenuMaximumHeight(
  viewport: ContextMenuViewport,
): number {
  return Math.max(
    0,
    viewport.height - CONTEXT_MENU_VIEWPORT_MARGIN * 2,
  );
}
