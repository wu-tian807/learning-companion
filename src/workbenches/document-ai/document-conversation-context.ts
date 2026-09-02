import { isAssetTarget, type AssetTarget } from '../../shared/workbench/anchor';
import type { JsonValue } from '../../shared/workbench/protocol';

export const DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID =
  'document-ai.context';

export interface DocumentImageReference {
  /** Markdown 图片相对源文件的路径（例如 images/foo.png）。 */
  readonly relativePath: string;
}

export type DocumentConversationContext = JsonValue & {
  readonly target: AssetTarget;
  readonly pageNumber?: number;
  readonly selectedText?: string;
  readonly previewDataUrl?: string;
  readonly image?: DocumentImageReference;
};

function isSafeImageRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_024) {
    return false;
  }
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':')
  ) {
    return false;
  }
  return value.split('/').every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..',
  );
}

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
        /^data:image\/(?:png|jpe?g);base64,/u.test(value.previewDataUrl))) &&
    (value.image === undefined ||
      (typeof value.image === 'object' &&
        value.image !== null &&
        !Array.isArray(value.image) &&
        isSafeImageRelativePath(
          (value.image as Record<string, unknown>).relativePath,
        )))
  );
}

export function createDocumentConversationContext(input: {
  readonly target: AssetTarget;
  readonly pageNumber?: number;
  readonly selectedText?: string;
  readonly previewDataUrl?: string;
  readonly image?: DocumentImageReference;
}): DocumentConversationContext {
  return Object.freeze({
    target: input.target,
    ...(input.pageNumber === undefined ? {} : { pageNumber: input.pageNumber }),
    ...(input.selectedText?.trim() ? { selectedText: input.selectedText.trim() } : {}),
    ...(input.previewDataUrl ? { previewDataUrl: input.previewDataUrl } : {}),
    ...(input.image ? { image: Object.freeze({ ...input.image }) } : {}),
  }) as DocumentConversationContext;
}
