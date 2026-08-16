import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  resolveWorkbenchAnchor,
  revealWorkbenchAnchor,
  WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT,
  type WorkbenchAnchorRect,
} from '../../../renderer/workbench/host/workbench-anchor-bridge';
import { getGlobalAiChatStore } from './ai-chat/chat-store';
import { groupQuestionAnchors } from './question-anchor-groups';

export function QuestionAnchorHost({
  projectId,
  assetId,
}: {
  readonly projectId: string;
  readonly assetId: string;
}) {
  const store = getGlobalAiChatStore();
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const [anchorRects, setAnchorRects] = useState<
    ReadonlyMap<string, WorkbenchAnchorRect>
  >(new Map());

  useEffect(() => {
    store.ensureSession(projectId, assetId);
  }, [assetId, projectId, store]);

  const groups = useMemo(
    () => groupQuestionAnchors(state.sessions.get(`ai-chat-${assetId}`)?.messages ?? []),
    [assetId, state.sessions],
  );

  const updateRects = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const next = new Map<string, WorkbenchAnchorRect>();
    for (const group of groups) {
      const rect = resolveWorkbenchAnchor(assetId, group.target);
      if (!rect) continue;
      next.set(group.key, {
        ...rect,
        left: rect.left - hostRect.left,
        top: rect.top - hostRect.top,
      });
    }
    setAnchorRects(next);
  }, [assetId, groups]);

  useEffect(() => {
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
  }, [updateRects]);

  return (
    <div
      ref={hostRef}
      className="pointer-events-none absolute inset-0 z-[21] overflow-visible"
      data-question-anchor-layer
    >
      {groups.map((group) => {
        const rect = anchorRects.get(group.key);
        if (!rect) return null;
        const latest = group.questions.at(-1)!;
        return (
          <button
            key={group.key}
            type="button"
            data-question-anchor-marker
            className="pointer-events-auto absolute z-30 cursor-pointer border-2 border-amber-300/75 bg-amber-300/[0.07] transition-colors hover:border-amber-200 hover:bg-amber-300/[0.14]"
            style={{
              left: rect.left,
              top: rect.top,
              width: Math.max(rect.width, 18),
              height: Math.max(rect.height, 18),
            }}
            title={`提问：${latest.content}`}
            aria-label={`查看此处提问：${latest.content}`}
            onClick={() => {
              revealWorkbenchAnchor(assetId, group.target);
              if (latest.conversationId) {
                store.selectConversation(assetId, latest.conversationId);
              }
              store.setPanelOpen(true);
            }}
          >
            <span className="absolute -right-3 -top-3 grid size-6 place-items-center rounded-full border border-amber-200/70 bg-[#3b3322] text-xs font-bold text-amber-100 shadow-[0_4px_12px_rgba(0,0,0,.45)]">
              ?
            </span>
          </button>
        );
      })}
    </div>
  );
}
