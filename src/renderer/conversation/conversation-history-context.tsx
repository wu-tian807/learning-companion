import type { ReactNode } from 'react';

import type { ConversationHistoryStore } from './conversation-contracts';
import { ConversationHistoryStoreContext } from './conversation-history-store-context';

export function ConversationHistoryStoreProvider({
  store,
  children,
}: {
  readonly store: ConversationHistoryStore;
  readonly children: ReactNode;
}) {
  return (
    <ConversationHistoryStoreContext.Provider value={store}>
      {children}
    </ConversationHistoryStoreContext.Provider>
  );
}
