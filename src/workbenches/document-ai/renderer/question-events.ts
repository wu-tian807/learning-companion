export const DOCUMENT_AI_QUESTION_COMMITTED_EVENT =
  'learning-companion:document-ai-question-committed';

export interface DocumentAiQuestionCommittedDetail {
  readonly assetId: string;
}

export function notifyDocumentAiQuestionCommitted(assetId: string): void {
  if (
    typeof window === 'undefined' ||
    typeof window.dispatchEvent !== 'function' ||
    typeof CustomEvent === 'undefined'
  ) return;
  window.dispatchEvent(new CustomEvent<DocumentAiQuestionCommittedDetail>(
    DOCUMENT_AI_QUESTION_COMMITTED_EVENT,
    { detail: { assetId } },
  ));
}
