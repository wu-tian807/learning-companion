import { useContext } from 'react';

import { ConversationHistoryStoreContext } from './conversation-history-store-context';

/** Undefined is intentional during server rendering outside a Project page. */
export function useProjectConversationHistoryStore() {
  return useContext(ConversationHistoryStoreContext);
}
