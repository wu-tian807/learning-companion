import { useCallback, useSyncExternalStore } from 'react';

import type { AiChatMessage } from './chat-store';
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
}

/**
 * 订阅全局 AI 对话 store，当 panelOpen 为 true 时渲染 AiChatPanel。
 * 放在 AssetWorkbenchHost 内部，与 workbench 视图并排显示。
 */
export function AiChatPanelHost({
  projectId,
  assetId,
  onAttachAnswer,
}: AiChatPanelHostProps) {
  const store = getGlobalAiChatStore();

  const panelOpen = useSyncExternalStore(
    useCallback((onChange: () => void) => store.subscribe(onChange), [store]),
    useCallback(() => store.getSnapshot().panelOpen, [store]),
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
