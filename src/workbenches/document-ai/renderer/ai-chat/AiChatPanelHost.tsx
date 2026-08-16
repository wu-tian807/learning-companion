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
    return null;
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
