import type { AssetTarget } from '../../shared/workbench/anchor';
import type { JsonValue } from '../../shared/workbench/protocol';

export interface DocumentAiRequest {
  readonly projectId: string;
  readonly assetId: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly question: string;
  readonly target: AssetTarget;
  readonly selectedText?: string;
}

export interface DocumentAiResponse {
  readonly answer: string;
  readonly providerId: string;
  readonly modelId: string;
}

export type DocumentQuestionTaskResult = JsonValue & DocumentAiResponse;

export function isDocumentQuestionTaskResult(
  value: unknown,
): value is DocumentQuestionTaskResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.answer === 'string' && record.answer.trim().length > 0 &&
    typeof record.providerId === 'string' &&
    record.providerId.trim().length > 0 &&
    typeof record.modelId === 'string' && record.modelId.trim().length > 0
  );
}
