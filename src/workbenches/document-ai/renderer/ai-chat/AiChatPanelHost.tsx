import { useCallback, useSyncExternalStore } from 'react';

import type { AiChatMessage, AiChatStore } from './chat-store';
import { getGlobalAiChatStore } from './chat-store';
import { AiChatPanel } from './AiChatPanel';

export interface AiChatPanelHostProps {
  readonly projectId: string;
  readonly assetId: string;
  readonly onAttachAnswer: (
    messageId: string,
    text: string,
    anchor?: AiChatMessage['anchor'],
  ) => Promise<void> | void;
  readonly store?: AiChatStore;
}

/**
 * 订阅全局 AI 对话 store，当 panelOpen 为 true 时渲染 AiChatPanel。
 * 放在 AssetWorkbenchHost 内部，与 workbench 视图并排显示。
 */
export function AiChatPanelHost({
  projectId,
  assetId,
  onAttachAnswer,
  store: providedStore,
}: AiChatPanelHostProps) {
  const store = providedStore ?? getGlobalAiChatStore();

  const panelOpen = useSyncExternalStore(
    useCallback((onChange: () => void) => store.subscribe(onChange), [store]),
    useCallback(() => store.getSnapshot().panelOpen, [store]),
    () => false,
  );

  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={() => store.setPanelOpen(true)}
        className="fixed bottom-20 right-5 z-[70] flex items-center gap-1.5 rounded-xl border border-indigo-300/25 bg-[#242b3b]/95 px-3 py-2 text-xs font-medium text-indigo-100 shadow-lg backdrop-blur hover:border-indigo-300/50 hover:bg-[#2b3448]"
        title="打开当前文档的 AI 问答"
      >
        <span aria-hidden="true">✦</span>
        AI 问答
      </button>
    );
  }

  return (
    <AiChatPanel
      projectId={projectId}
      assetId={assetId}
      onClose={() => store.setPanelOpen(false)}
      onAttachAnswer={onAttachAnswer}
    />
  );
}
