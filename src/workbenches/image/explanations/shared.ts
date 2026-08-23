import {
  IMAGE_REGION_ANCHOR_TYPE,
  IMAGE_REGION_ANCHOR_VERSION,
  isImageRegionAnchorV1,
  type ImageRegionTarget,
} from '../shared';
export type { ImageRegionTarget } from '../shared';

export const IMAGE_EXPLANATION_ATTACHMENT_TYPE = 'image.ai-explanation';
export const IMAGE_EXPLANATION_ATTACHMENT_VERSION = 1;
export const IMAGE_DEFAULT_EXPLANATION_QUESTION = '请解释这个图片区域。';
export const IMAGE_EXPLANATION_ANSWER_MAX_LENGTH = 32_768;

export const IMAGE_EXPLANATION_IPC_CHANNELS = Object.freeze({
  list: 'image-explanation:list',
  create: 'image-explanation:create',
  retry: 'image-explanation:retry',
  delete: 'image-explanation:delete',
  changed: 'image-explanation:changed',
});

export interface ImageExplanationMetadata {
  readonly format: 'learning-companion/image-explanation';
  readonly version: 1;
  readonly sourceRevision: string;
}

interface ImageExplanationViewBase {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly target: ImageRegionTarget;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface ImageExplanationTaskView extends ImageExplanationViewBase {
  readonly kind: 'task';
  readonly status: 'pending' | 'failed';
  readonly failureMessage?: string;
  readonly sourceRevision?: string;
}

export interface ImageExplanationAttachmentView
  extends ImageExplanationViewBase {
  readonly kind: 'attachment';
  readonly status: 'completed';
  readonly answer: string;
  readonly sourceRevision: string;
}

export type ImageExplanationView =
  | ImageExplanationTaskView
  | ImageExplanationAttachmentView;

interface ImageExplanationAssetRequest {
  readonly projectId: string;
  readonly assetId: string;
}

export interface ListImageExplanationsRequest
  extends ImageExplanationAssetRequest {
  readonly sourceRevision: string;
}

export interface CreateImageExplanationRequest
  extends ListImageExplanationsRequest {
  readonly target: ImageRegionTarget;
}

export interface ImageExplanationIdRequest
  extends ImageExplanationAssetRequest {
  readonly kind: ImageExplanationView['kind'];
  readonly explanationId: string;
}

export type ImageExplanationEvent =
  | { readonly type: 'changed'; readonly explanation: ImageExplanationView }
  | {
      readonly type: 'replaced';
      readonly projectId: string;
      readonly assetId: string;
      readonly previousExplanationId: string;
      readonly explanation: ImageExplanationAttachmentView;
    }
  | {
      readonly type: 'deleted';
      readonly projectId: string;
      readonly assetId: string;
      readonly explanationId: string;
    };

export interface ImageExplanationPreloadApi {
  listImageExplanations(
    request: ListImageExplanationsRequest,
  ): Promise<ImageExplanationView[]>;
  createImageExplanation(
    request: CreateImageExplanationRequest,
  ): Promise<ImageExplanationView>;
  retryImageExplanation(
    request: ImageExplanationIdRequest,
  ): Promise<ImageExplanationView>;
  deleteImageExplanation(request: ImageExplanationIdRequest): Promise<void>;
  onImageExplanationChanged(
    listener: (event: ImageExplanationEvent) => void,
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

export function isImageRegionTarget(
  value: unknown,
): value is ImageRegionTarget {
  return (
    isRecord(value) &&
    value.scope === 'content' &&
    value.anchorType === IMAGE_REGION_ANCHOR_TYPE &&
    value.anchorVersion === IMAGE_REGION_ANCHOR_VERSION &&
    isImageRegionAnchorV1(value.anchorPayload)
  );
}

export function isImageExplanationMetadata(
  value: unknown,
): value is ImageExplanationMetadata {
  return (
    isRecord(value) &&
    value.format === 'learning-companion/image-explanation' &&
    value.version === 1 &&
    isRequiredText(value.sourceRevision, 256)
  );
}

export function isListImageExplanationsRequest(
  value: unknown,
): value is ListImageExplanationsRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256) &&
    isRequiredText(value.sourceRevision, 256)
  );
}

export function isCreateImageExplanationRequest(
  value: unknown,
): value is CreateImageExplanationRequest {
  return (
    isRecord(value) &&
    isListImageExplanationsRequest(value) &&
    isImageRegionTarget(value.target)
  );
}

export function isImageExplanationIdRequest(
  value: unknown,
): value is ImageExplanationIdRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256) &&
    (value.kind === 'task' || value.kind === 'attachment') &&
    isRequiredText(value.explanationId, 256)
  );
}

export function isImageExplanationView(
  value: unknown,
): value is ImageExplanationView {
  return (
    isRecord(value) &&
    isRequiredText(value.id, 256) &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256) &&
    isImageRegionTarget(value.target) &&
    ((value.kind === 'task' &&
      (value.status === 'pending' || value.status === 'failed') &&
      value.answer === undefined &&
      (value.sourceRevision === undefined ||
        isRequiredText(value.sourceRevision, 256)) &&
      (value.failureMessage === undefined ||
        typeof value.failureMessage === 'string')) ||
      (value.kind === 'attachment' &&
        value.status === 'completed' &&
        typeof value.answer === 'string' &&
        isRequiredText(value.sourceRevision, 256) &&
        value.failureMessage === undefined)) &&
    isTime(value.createdTime) &&
    isTime(value.updatedTime)
  );
}

export function isImageExplanationEvent(
  value: unknown,
): value is ImageExplanationEvent {
  if (!isRecord(value)) return false;
  if (value.type === 'changed') {
    return isImageExplanationView(value.explanation);
  }
  if (value.type === 'replaced') {
    return (
      isRequiredText(value.projectId, 256) &&
      isRequiredText(value.assetId, 256) &&
      isRequiredText(value.previousExplanationId, 256) &&
      isImageExplanationView(value.explanation) &&
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
