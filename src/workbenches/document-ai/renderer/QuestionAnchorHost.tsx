import { useEffect, useMemo, useState } from 'react';

import { useProjectConversationHistoryStore } from '../../../renderer/conversation/use-project-conversation-history-store';
import type {
  ConversationHistoryStore,
  ConversationRecord,
} from '../../../renderer/conversation/conversation-contracts';
import { useWorkbenchConversationRuntime } from '../../../renderer/conversation/workbench-conversation-context';
import { revealWorkbenchAnchor } from '../../../renderer/workbench/host/workbench-anchor-bridge';
import type { ContentAnchorTarget } from '../../../shared/workbench/anchor';
import { isDocumentConversationContext } from '../document-conversation-context';
import { useWorkbenchAnchorRects } from './use-workbench-anchor-rects';

interface QuestionAnchorGroup {
  readonly key: string;
  readonly target: ContentAnchorTarget;
  readonly conversations: readonly ConversationRecord[];
}

function groupQuestionAnchors(
  history: readonly ConversationRecord[],
  assetId: string,
): readonly QuestionAnchorGroup[] {
  const groups = new Map<string, {
    target: ContentAnchorTarget;
    conversations: ConversationRecord[];
  }>();
  for (const conversation of history) {
    for (const message of conversation.messages) {
      if (
        message.role !== 'user' ||
        message.contextSource?.assetId !== assetId ||
        !isDocumentConversationContext(message.context) ||
        message.context.target.scope !== 'content'
      ) continue;
      const key = JSON.stringify(message.context.target);
      const group = groups.get(key) ?? {
        target: message.context.target,
        conversations: [],
      };
      if (!group.conversations.some(({ id }) => id === conversation.id)) {
        group.conversations.push(conversation);
      }
      groups.set(key, group);
    }
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    target: group.target,
    conversations: Object.freeze(
      group.conversations.sort((left, right) => left.updatedTime - right.updatedTime),
    ),
  }));
}

function useHistory(store: ConversationHistoryStore | undefined): readonly ConversationRecord[] {
  const [history, setHistory] = useState<readonly ConversationRecord[]>(
    () => store?.getSnapshot?.() ?? [],
  );
  useEffect(() => {
    if (!store) return;
    let active = true;
    void store.list().then((records) => {
      if (active) setHistory(records);
    });
    const unsubscribe = store.subscribe?.(() => {
      setHistory(store.getSnapshot?.() ?? []);
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
}: {
  readonly assetId: string;
}) {
  const runtime = useWorkbenchConversationRuntime();
  const historyStore = useProjectConversationHistoryStore();
  const history = useHistory(historyStore);
  const groups = useMemo(() => groupQuestionAnchors(history, assetId), [assetId, history]);
  const entries = useMemo(
    () => groups.map((group) => ({ key: group.key, target: group.target })),
    [groups],
  );
  const { hostRef, anchorRects } = useWorkbenchAnchorRects(assetId, entries);
  const [selectedKey, setSelectedKey] = useState<string>();

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[41] overflow-visible" data-question-anchor-layer>
      {groups.map((group) => {
        const rect = anchorRects.get(group.key);
        if (!rect) return null;
        const latest = group.conversations.at(-1)!;
        const open = selectedKey === group.key;
        return (
          <div
            key={group.key}
            className="pointer-events-auto absolute"
            style={{
              left: rect.left,
              top: rect.top,
              width: Math.max(rect.width, 18),
              height: Math.max(rect.height, 18),
            }}
          >
            <button
              type="button"
              data-question-anchor-marker
              className="absolute inset-0 cursor-pointer border-2 border-amber-300/75 bg-amber-300/[0.07] transition-colors hover:border-amber-200 hover:bg-amber-300/[0.14]"
              title={`查看提问：${latest.title}`}
              aria-label={`查看此处提问：${latest.title}`}
              onClick={() => setSelectedKey(open ? undefined : group.key)}
            >
              <span className="absolute -right-3 -top-3 grid size-6 place-items-center rounded-full border border-amber-200/70 bg-[#3b3322] text-xs font-bold text-amber-100 shadow-[0_4px_12px_rgba(0,0,0,.45)]">
                {group.conversations.length > 1 ? group.conversations.length : '?'}
              </span>
            </button>
            {open && (
              <div className="absolute left-0 top-full z-50 mt-2 w-52 rounded-xl border border-amber-200/25 bg-[#20262e] p-2 shadow-[0_12px_32px_rgba(0,0,0,.5)]">
                <p className="line-clamp-2 px-1 pb-2 text-xs text-slate-300">{latest.title}</p>
                <button
                  type="button"
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-indigo-200 hover:bg-indigo-400/10"
                  onClick={() => {
                    revealWorkbenchAnchor(assetId, group.target);
                    runtime.open({ conversationId: latest.id });
                    setSelectedKey(undefined);
                  }}
                >
                  查看提问
                </button>
                <button
                  type="button"
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-400/10"
                  onClick={() => {
                    if (!window.confirm(`删除此处 ${group.conversations.length} 条提问及回答？`)) return;
                    if (!historyStore) return;
                    void (async () => {
                      for (const { id } of group.conversations) {
                        await historyStore.remove(id);
                      }
                    })();
                    setSelectedKey(undefined);
                  }}
                >
                  删除提问
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
