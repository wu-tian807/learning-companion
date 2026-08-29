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
  enabled = true,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [anchorRects, setAnchorRects] = useState<
    ReadonlyMap<string, WorkbenchAnchorRect>
  >(new Map());

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
    if (!enabled) return;
    updateRects();
    window.addEventListener(WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT, updateRects);
    window.addEventListener('resize', updateRects);
    const host = hostRef.current;
    const observedContainer = host?.parentElement ?? host;
    const mutationObserver = new MutationObserver(updateRects);
    const resizeObserver = new ResizeObserver(updateRects);
    if (observedContainer) {
      mutationObserver.observe(observedContainer, { childList: true, subtree: true });
      resizeObserver.observe(observedContainer);
    }
    return () => {
      window.removeEventListener(WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT, updateRects);
      window.removeEventListener('resize', updateRects);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [enabled, updateRects]);

  return { hostRef, anchorRects };
}
