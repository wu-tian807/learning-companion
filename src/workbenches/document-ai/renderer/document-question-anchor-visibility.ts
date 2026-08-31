import { createContext, useContext } from 'react';

export const DocumentQuestionAnchorsVisibleContext = createContext(true);

export function useDocumentQuestionAnchorsVisible(): boolean {
  return useContext(DocumentQuestionAnchorsVisibleContext);
}
