import type { JsonValue } from '../../shared/workbench/protocol';

interface DocumentQuestionResultFields {
  readonly answer: string;
  readonly title?: string;
  readonly providerId: string;
  readonly modelId: string;
}

export type DocumentQuestionTaskResult = JsonValue & DocumentQuestionResultFields;

export function isDocumentQuestionTaskResult(
  value: unknown,
): value is DocumentQuestionTaskResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.answer === 'string' && record.answer.trim().length > 0 &&
    (record.title === undefined || typeof record.title === 'string') &&
    typeof record.providerId === 'string' &&
    record.providerId.trim().length > 0 &&
    typeof record.modelId === 'string' && record.modelId.trim().length > 0
  );
}
