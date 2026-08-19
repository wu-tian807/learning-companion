import {
  EPUB_CFI_RANGE_ANCHOR_TYPE,
  EPUB_CFI_RANGE_ANCHOR_VERSION,
  isEpubCfiRangeAnchorV1,
  type EpubCfiRangeTarget,
} from '../shared';
import type { JsonValue } from '../../../shared/workbench/protocol';

export type { EpubCfiRangeTarget } from '../shared';

export const EPUB_EXPLANATION_ATTACHMENT_TYPE = 'epub.ai-explanation';
export const EPUB_EXPLANATION_ATTACHMENT_VERSION = 1;
export const EPUB_EXPLANATION_TASK_DEFINITION_ID = 'epub.explain-selection';
export const EPUB_EXPLANATION_TASK_DEFINITION_VERSION = 1;
export const EPUB_EXPLANATION_INSTRUCTION_FORMAT =
  'learning-companion/epub-explanation-instruction';
export const EPUB_EXPLANATION_INSTRUCTION_VERSION = 1;
export const EPUB_DEFAULT_EXPLANATION_QUESTION = '请解释这段话。';
export const EPUB_EXPLANATION_ANSWER_MAX_LENGTH = 32_768;

export const EPUB_EXPLANATION_IPC_CHANNELS = Object.freeze({
  list: 'epub-explanation:list',
  create: 'epub-explanation:create',
  retry: 'epub-explanation:retry',
  delete: 'epub-explanation:delete',
  changed: 'epub-explanation:changed',
});

export interface EpubExplanationMetadata {
  readonly format: 'learning-companion/epub-explanation';
  readonly version: 1;
}

export type EpubExplanationTaskResult = JsonValue & {
  readonly answer: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly title?: string;
  readonly attachmentId?: string;
};

interface EpubExplanationViewBase {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly target: EpubCfiRangeTarget;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface EpubExplanationTaskView extends EpubExplanationViewBase {
  readonly kind: 'task';
  readonly status: 'pending' | 'failed';
  readonly failureMessage?: string;
}

export interface EpubExplanationAttachmentView
  extends EpubExplanationViewBase {
  readonly kind: 'attachment';
  readonly status: 'completed';
  readonly answer: string;
}

/** Renderer projection. Pending/failed rows come from GenerationTask; completed rows come from Attachment. */
export type EpubExplanationView =
  | EpubExplanationTaskView
  | EpubExplanationAttachmentView;

export interface ListEpubExplanationsRequest {
  readonly projectId: string;
  readonly assetId: string;
}

export interface CreateEpubExplanationRequest
  extends ListEpubExplanationsRequest {
  readonly target: EpubCfiRangeTarget;
}

export interface EpubExplanationIdRequest
  extends ListEpubExplanationsRequest {
  readonly kind: EpubExplanationView['kind'];
  readonly explanationId: string;
}

export type EpubExplanationEvent =
  | {
      readonly type: 'changed';
      readonly explanation: EpubExplanationView;
    }
  | {
      readonly type: 'replaced';
      readonly projectId: string;
      readonly assetId: string;
      readonly previousExplanationId: string;
      readonly explanation: EpubExplanationAttachmentView;
    }
  | {
      readonly type: 'deleted';
      readonly projectId: string;
      readonly assetId: string;
      readonly explanationId: string;
    };

export interface EpubExplanationPreloadApi {
  listEpubExplanations(
    request: ListEpubExplanationsRequest,
  ): Promise<EpubExplanationView[]>;
  createEpubExplanation(
    request: CreateEpubExplanationRequest,
  ): Promise<EpubExplanationView>;
  retryEpubExplanation(
    request: EpubExplanationIdRequest,
  ): Promise<EpubExplanationView>;
  deleteEpubExplanation(
    request: EpubExplanationIdRequest,
  ): Promise<void>;
  onEpubExplanationChanged(
    listener: (event: EpubExplanationEvent) => void,
  ): () => void;
}

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
  return (
    isRecord(value) &&
    value.scope === 'content' &&
    value.anchorType === EPUB_CFI_RANGE_ANCHOR_TYPE &&
    value.anchorVersion === EPUB_CFI_RANGE_ANCHOR_VERSION &&
    isEpubCfiRangeAnchorV1(value.anchorPayload)
  );
}

export function isEpubExplanationMetadata(
  value: unknown,
): value is EpubExplanationMetadata {
  return (
    isRecord(value) &&
    value.format === 'learning-companion/epub-explanation' &&
    value.version === 1
  );
}

export function isEpubExplanationTaskResult(
  value: unknown,
): value is EpubExplanationTaskResult {
  if (!isRecord(value)) return false;
  return (
    isRequiredText(value.answer, EPUB_EXPLANATION_ANSWER_MAX_LENGTH) &&
    isRequiredText(value.providerId, 256) &&
    isRequiredText(value.modelId, 256) &&
    (value.title === undefined || isRequiredText(value.title, 128)) &&
    (value.attachmentId === undefined ||
      isRequiredText(value.attachmentId, 256))
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
    isRecord(value) &&
    isListEpubExplanationsRequest(value) &&
    (value.kind === 'task' || value.kind === 'attachment') &&
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
    ((value.kind === 'task' &&
      (value.status === 'pending' || value.status === 'failed') &&
      value.answer === undefined &&
      (value.failureMessage === undefined ||
        typeof value.failureMessage === 'string')) ||
      (value.kind === 'attachment' &&
        value.status === 'completed' &&
        typeof value.answer === 'string' &&
        value.failureMessage === undefined)) &&
    isTime(value.createdTime) &&
    isTime(value.updatedTime)
  );
}

export function isEpubExplanationEvent(
  value: unknown,
): value is EpubExplanationEvent {
  if (!isRecord(value)) return false;
  if (value.type === 'changed') {
    return isEpubExplanationView(value.explanation);
  }
  if (value.type === 'replaced') {
    return (
      isRequiredText(value.projectId, 256) &&
      isRequiredText(value.assetId, 256) &&
      isRequiredText(value.previousExplanationId, 256) &&
      isEpubExplanationView(value.explanation) &&
      value.explanation.kind === 'attachment' &&
      value.explanation.projectId === value.projectId &&
      value.explanation.assetId === value.assetId
    );
  }
  return (
    value.type === 'deleted' &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256) &&
    isRequiredText(value.explanationId, 256)
  );
}
