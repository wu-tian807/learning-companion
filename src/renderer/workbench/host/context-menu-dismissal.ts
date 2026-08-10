export function observeOutsideContextMenuPointer(
  documentTarget: Document,
  getMenuRoot: () => HTMLElement | null,
  onDismiss: () => void,
): () => void {
  const closeOnOutsidePointer = (event: PointerEvent) => {
    if (!getMenuRoot()?.contains(event.target as Node)) {
      onDismiss();
    }
  };

  // Canvas viewers such as OpenSeadragon may consume pointer events before
  // they bubble to document. Capture makes dismissal consistent without
  // placing an interaction-blocking overlay above the Workbench.
  documentTarget.addEventListener(
    'pointerdown',
    closeOnOutsidePointer,
    true,
  );

  return () => {
    documentTarget.removeEventListener(
      'pointerdown',
      closeOnOutsidePointer,
      true,
    );
  };
}
