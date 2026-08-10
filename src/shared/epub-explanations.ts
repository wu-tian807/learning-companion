import type { ContentAnchorTarget } from './workbench/anchor';

export const EPUB_EXPLANATION_ATTACHMENT_TYPE = 'epub.ai-explanation';
export const EPUB_EXPLANATION_ATTACHMENT_VERSION = 1;
export const EPUB_EXPLANATION_TASK_DEFINITION_ID = 'epub.explain-selection';
export const EPUB_EXPLANATION_TASK_DEFINITION_VERSION = 1;
export const EPUB_EXPLANATION_INSTRUCTION_FORMAT =
  'learning-companion/epub-explanation-instruction';
export const EPUB_EXPLANATION_INSTRUCTION_VERSION = 1;

export type EpubExplanationStatus = 'pending' | 'completed' | 'failed';

export interface EpubCfiRangeTarget extends ContentAnchorTarget {
  readonly anchorType: 'epub.cfi-range';
  readonly anchorVersion: 1;
  readonly anchorPayload: {
    readonly cfiRange: string;
    readonly quote: {
      readonly exact: string;
      readonly prefix: string;
      readonly suffix: string;
    };
  };
}

export interface EpubExplanationView {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly target: EpubCfiRangeTarget;
  readonly status: EpubExplanationStatus;
  readonly taskId?: string;
  readonly answer?: string;
  readonly failureMessage?: string;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface ListEpubExplanationsRequest {
  readonly projectId: string;
  readonly assetId: string;
}

export interface CreateEpubExplanationRequest
  extends ListEpubExplanationsRequest {
  readonly target: EpubCfiRangeTarget;
}

export interface EpubExplanationIdRequest {
  readonly projectId: string;
  readonly assetId: string;
  readonly explanationId: string;
}

export type EpubExplanationEvent =
  | {
      readonly type: 'changed';
      readonly explanation: EpubExplanationView;
    }
  | {
      readonly type: 'deleted';
      readonly projectId: string;
      readonly assetId: string;
      readonly explanationId: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown, maximum = 16_384): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isEpubCfiRangeTarget(
  value: unknown,
): value is EpubCfiRangeTarget {
  if (
    !isRecord(value) ||
    value.scope !== 'content' ||
    value.anchorType !== 'epub.cfi-range' ||
    value.anchorVersion !== 1 ||
    !isRecord(value.anchorPayload) ||
    !isRequiredText(value.anchorPayload.cfiRange, 8_192) ||
    !isRecord(value.anchorPayload.quote)
  ) {
    return false;
  }

  const quote = value.anchorPayload.quote;
  return (
    isRequiredText(quote.exact) &&
    typeof quote.prefix === 'string' &&
    quote.prefix.length <= 256 &&
    typeof quote.suffix === 'string' &&
    quote.suffix.length <= 256
  );
}

export function isListEpubExplanationsRequest(
  value: unknown,
): value is ListEpubExplanationsRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256)
  );
}

export function isCreateEpubExplanationRequest(
  value: unknown,
): value is CreateEpubExplanationRequest {
  return (
    isRecord(value) &&
    isListEpubExplanationsRequest(value) &&
    isEpubCfiRangeTarget(value.target)
  );
}

export function isEpubExplanationIdRequest(
  value: unknown,
): value is EpubExplanationIdRequest {
  return (
    isListEpubExplanationsRequest(value) &&
    isRecord(value) &&
    isRequiredText(value.explanationId, 256)
  );
}

export function isEpubExplanationView(
  value: unknown,
): value is EpubExplanationView {
  return (
    isRecord(value) &&
    isRequiredText(value.id, 256) &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256) &&
    isEpubCfiRangeTarget(value.target) &&
    (value.status === 'pending' ||
      value.status === 'completed' ||
      value.status === 'failed') &&
    (value.taskId === undefined || isRequiredText(value.taskId, 256)) &&
    (value.answer === undefined || typeof value.answer === 'string') &&
    (value.failureMessage === undefined ||
      typeof value.failureMessage === 'string') &&
    isTime(value.createdTime) &&
    isTime(value.updatedTime)
  );
}

export function isEpubExplanationEvent(
  value: unknown,
): value is EpubExplanationEvent {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === 'changed') {
    return isEpubExplanationView(value.explanation);
  }

  return (
    value.type === 'deleted' &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256) &&
    isRequiredText(value.explanationId, 256)
  );
}
