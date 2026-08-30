import type { ReactNode } from 'react';

import type { ConversationHistoryStore } from './conversation-contracts';
import { ProjectConversationHistoryContext } from './project-conversation-history-context';

export function ProjectConversationHistoryProvider({
  store,
  children,
}: {
  readonly store: ConversationHistoryStore;
  readonly children: ReactNode;
}) {
  return (
    <ProjectConversationHistoryContext.Provider value={store}>
      {children}
    </ProjectConversationHistoryContext.Provider>
  );
}
