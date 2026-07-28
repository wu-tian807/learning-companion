export function resolveContextMenuViewportPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  menuWidth = 240,
  menuHeight = 340,
): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(x, viewportWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(y, viewportHeight - menuHeight - 8)),
  };
}
