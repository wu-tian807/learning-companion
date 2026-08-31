import { useEffect, useMemo, useState } from 'react';

import type {
  ConversationHistoryStore,
  ConversationRecord,
} from '../../../renderer/conversation/conversation-contracts';
import { useOptionalProjectConversationHistoryStore } from '../../../renderer/conversation/project-conversation-history-context';
import type { WorkbenchConversationRuntime } from '../../../renderer/conversation/workbench-conversation-runtime';
import {
  revealWorkbenchAnchor,
} from '../../../renderer/workbench/host/workbench-anchor-bridge';
import { groupConversationQuestionAnchors } from './conversation/conversation-question-anchors';
import { useDocumentQuestionAnchorsVisible } from './document-question-anchor-visibility';
import { useWorkbenchAnchorRects } from './use-workbench-anchor-rects';

function useHistory(store: ConversationHistoryStore): readonly ConversationRecord[] {
  const [history, setHistory] = useState<readonly ConversationRecord[]>(
    () => store.getSnapshot?.() ?? [],
  );
  useEffect(() => {
    let active = true;
    void store.list().then(
      (records) => {
        if (active) setHistory(records);
      },
      () => {
        // The Conversation panel owns persistence error presentation.
      },
    );
    const unsubscribe = store.subscribe?.(() => {
      const records = store.getSnapshot?.();
      if (records) setHistory(records);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [store]);
  return history;
}

export function QuestionAnchorHost({
  assetId,
  ownerId,
  runtime,
}: {
  readonly assetId: string;
  readonly ownerId: string;
  readonly runtime: WorkbenchConversationRuntime;
}) {
  const historyStore = useOptionalProjectConversationHistoryStore();
  if (!historyStore) return null;
  return (
    <QuestionAnchorHostWithStore
      assetId={assetId}
      ownerId={ownerId}
      runtime={runtime}
      historyStore={historyStore}
    />
  );
}

function QuestionAnchorHostWithStore({
  assetId,
  ownerId,
  runtime,
  historyStore,
}: {
  readonly assetId: string;
  readonly ownerId: string;
  readonly runtime: WorkbenchConversationRuntime;
  readonly historyStore: ConversationHistoryStore;
}) {
  const visible = useDocumentQuestionAnchorsVisible();
  const history = useHistory(historyStore);
  const groups = useMemo(() => groupConversationQuestionAnchors(history), [history]);
  const anchorEntries = useMemo(
    () => groups.map((group) => ({ key: group.key, target: group.target })),
    [groups],
  );
  const { hostRef, anchorRects } = useWorkbenchAnchorRects(
    assetId,
    anchorEntries,
    visible,
  );

  if (!visible) return null;

  return (
    <div
      ref={hostRef}
      className="pointer-events-none absolute inset-0 z-[21] overflow-visible"
      data-question-anchor-layer
    >
      {groups.map((group) => {
        const rect = anchorRects.get(group.key);
        if (!rect) return null;
        const latest = group.entries.at(-1)!;
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
            title={`查看提问：${latest.message.text}`}
            aria-label={`查看此处提问：${latest.message.text}`}
            onClick={() => {
              revealWorkbenchAnchor(assetId, group.target);
              runtime.open({
                ownerId,
                conversationId: latest.conversation.id,
                context: latest.message.context,
              });
            }}
          >
            <span className="absolute -right-3 -top-3 grid size-6 place-items-center rounded-full border border-amber-200/70 bg-[#3b3322] text-xs font-bold text-amber-100 shadow-[0_4px_12px_rgba(0,0,0,.45)]">
              {group.entries.length > 1 ? group.entries.length : '?'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
