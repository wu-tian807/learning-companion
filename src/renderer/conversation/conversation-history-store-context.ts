import { createContext } from 'react';

import type { ConversationHistoryStore } from './conversation-contracts';

export const ConversationHistoryStoreContext =
  createContext<ConversationHistoryStore | undefined>(undefined);
