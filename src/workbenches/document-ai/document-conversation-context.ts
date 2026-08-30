import { isAssetTarget, type AssetTarget } from '../../shared/workbench/anchor';
import type { JsonValue } from '../../shared/workbench/protocol';

export const DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID =
  'document-ai.context';

export type DocumentConversationContext = JsonValue & {
  readonly target: AssetTarget;
  readonly pageNumber?: number;
  readonly selectedText?: string;
  readonly previewDataUrl?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDocumentConversationContext(
  value: unknown,
): value is DocumentConversationContext {
  if (!isRecord(value) || !isAssetTarget(value.target)) return false;
  return (
    (value.pageNumber === undefined ||
      (Number.isSafeInteger(value.pageNumber) && Number(value.pageNumber) > 0)) &&
    (value.selectedText === undefined || typeof value.selectedText === 'string') &&
    (value.previewDataUrl === undefined ||
      (typeof value.previewDataUrl === 'string' &&
        /^data:image\/(?:png|jpe?g);base64,/u.test(value.previewDataUrl)))
  );
}

export function createDocumentConversationContext(input: {
  readonly target: AssetTarget;
  readonly pageNumber?: number;
  readonly selectedText?: string;
  readonly previewDataUrl?: string;
}): DocumentConversationContext {
  return Object.freeze({
    target: input.target,
    ...(input.pageNumber === undefined ? {} : { pageNumber: input.pageNumber }),
    ...(input.selectedText?.trim() ? { selectedText: input.selectedText.trim() } : {}),
    ...(input.previewDataUrl ? { previewDataUrl: input.previewDataUrl } : {}),
  }) as DocumentConversationContext;
}

export function describeDocumentConversationContext(
  context: unknown,
  contextLabel = '资料内容',
) {
  if (!isDocumentConversationContext(context)) {
    return { label: contextLabel };
  }
  return {
    label: context.pageNumber
      ? `第 ${context.pageNumber} 页`
      : contextLabel,
    ...(context.selectedText
      ? { detail: context.selectedText }
      : { detail: '已框选公式、图表或图片区域' }),
    ...(context.previewDataUrl
      ? { previewDataUrl: context.previewDataUrl }
      : {}),
  };
}
