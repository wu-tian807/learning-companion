import { useCallback, useEffect, useRef, useState } from 'react';

import type { AssetTarget } from '../../../shared/workbench/anchor';
import {
  resolveWorkbenchAnchor,
  WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT,
  type WorkbenchAnchorRect,
} from '../../../renderer/workbench/host/workbench-anchor-bridge';

export interface WorkbenchAnchorEntry {
  readonly key: string;
  readonly target: AssetTarget;
}

export function useWorkbenchAnchorRects(
  assetId: string,
  entries: readonly WorkbenchAnchorEntry[],
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [anchorRects, setAnchorRects] = useState<ReadonlyMap<string, WorkbenchAnchorRect>>(
    new Map(),
  );

  const updateRects = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const next = new Map<string, WorkbenchAnchorRect>();
    for (const entry of entries) {
      const rect = resolveWorkbenchAnchor(assetId, entry.target);
      if (!rect) continue;
      next.set(entry.key, {
        ...rect,
        left: rect.left - hostRect.left,
        top: rect.top - hostRect.top,
      });
    }
    setAnchorRects(next);
  }, [assetId, entries]);

  useEffect(() => {
    updateRects();
    window.addEventListener(WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT, updateRects);
    window.addEventListener('resize', updateRects);
    const host = hostRef.current;
    const observed = host?.parentElement ?? host;
    const resizeObserver = new ResizeObserver(updateRects);
    const mutationObserver = new MutationObserver(updateRects);
    if (observed) {
      resizeObserver.observe(observed);
      mutationObserver.observe(observed, { childList: true, subtree: true });
    }
    return () => {
      window.removeEventListener(WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT, updateRects);
      window.removeEventListener('resize', updateRects);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [updateRects]);

  return { hostRef, anchorRects };
}
