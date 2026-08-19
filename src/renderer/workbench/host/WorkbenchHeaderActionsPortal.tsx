import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

function getWorkbenchHeaderActionSlot(): Element | null {
  return document.querySelector('[data-workbench-header-actions]');
}

function subscribeWorkbenchHeaderActionSlot(onChange: () => void): () => void {
  let currentSlot = getWorkbenchHeaderActionSlot();
  const observer = new MutationObserver(() => {
    const nextSlot = getWorkbenchHeaderActionSlot();
    if (nextSlot === currentSlot) return;
    currentSlot = nextSlot;
    onChange();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function WorkbenchHeaderActionsPortal({
  children,
}: {
  readonly children: ReactNode;
}) {
  const slot = useSyncExternalStore(
    subscribeWorkbenchHeaderActionSlot,
    getWorkbenchHeaderActionSlot,
    () => null,
  );
  return slot ? createPortal(children, slot) : null;
}
