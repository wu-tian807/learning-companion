import { createContext, useContext } from 'react';

import type { ConversationHistoryStore } from './conversation-contracts';

export const ProjectConversationHistoryContext =
  createContext<ConversationHistoryStore | null>(null);

export function useProjectConversationHistoryStore(): ConversationHistoryStore {
  const store = useContext(ProjectConversationHistoryContext);
  if (!store) {
    throw new Error('ProjectConversationHistoryProvider 缺失');
  }
  return store;
}

export function useOptionalProjectConversationHistoryStore():
  | ConversationHistoryStore
  | undefined {
  return useContext(ProjectConversationHistoryContext) ?? undefined;
}
