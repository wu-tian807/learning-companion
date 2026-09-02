import {
  isVideoFrameRegionTarget,
  type VideoFrameRegionTarget,
} from '../shared';

export const VIDEO_EXPLANATION_ATTACHMENT_TYPE = 'video.ai-explanation';
export const VIDEO_EXPLANATION_ATTACHMENT_VERSION = 1;
export const VIDEO_EXPLANATION_ANSWER_MAX_LENGTH = 32_768;

export const VIDEO_EXPLANATION_IPC_CHANNELS = Object.freeze({
  list: 'video-explanation:list',
  retry: 'video-explanation:retry',
  delete: 'video-explanation:delete',
  changed: 'video-explanation:changed',
});

export interface VideoExplanationMetadata {
  readonly format: 'learning-companion/video-explanation';
  readonly version: 1;
  readonly sourceRevision: string;
  readonly question: string;
  /** Stable Conversation/Provider Session that produced this explanation. */
  readonly conversationId?: string;
}

interface VideoExplanationViewBase {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly target: VideoFrameRegionTarget;
  readonly sourceRevision: string;
  readonly question: string;
  readonly conversationId?: string;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface VideoExplanationTaskView extends VideoExplanationViewBase {
  readonly kind: 'task';
  readonly status: 'pending' | 'failed';
  readonly failureMessage?: string;
}

export interface VideoExplanationAttachmentView
  extends VideoExplanationViewBase {
  readonly kind: 'attachment';
  readonly status: 'completed';
  readonly answer: string;
}

export type VideoExplanationView =
  | VideoExplanationTaskView
  | VideoExplanationAttachmentView;

interface VideoExplanationAssetRequest {
  readonly projectId: string;
  readonly assetId: string;
}

export interface ListVideoExplanationsRequest
  extends VideoExplanationAssetRequest {
  readonly sourceRevision: string;
}

export interface VideoExplanationIdRequest
  extends VideoExplanationAssetRequest {
  readonly kind: VideoExplanationView['kind'];
  readonly explanationId: string;
}

export type VideoExplanationEvent =
  | { readonly type: 'changed'; readonly explanation: VideoExplanationView }
  | {
      readonly type: 'replaced';
      readonly projectId: string;
      readonly assetId: string;
      readonly previousExplanationId: string;
      readonly explanation: VideoExplanationAttachmentView;
    }
  | {
      readonly type: 'deleted';
      readonly projectId: string;
      readonly assetId: string;
      readonly explanationId: string;
    };

export interface VideoExplanationPreloadApi {
  listVideoExplanations(
    request: ListVideoExplanationsRequest,
  ): Promise<VideoExplanationView[]>;
  retryVideoExplanation(
    request: VideoExplanationIdRequest,
  ): Promise<VideoExplanationView>;
  deleteVideoExplanation(request: VideoExplanationIdRequest): Promise<void>;
  onVideoExplanationChanged(
    listener: (event: VideoExplanationEvent) => void,
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

export function isVideoExplanationMetadata(
  value: unknown,
): value is VideoExplanationMetadata {
  return (
    isRecord(value) &&
    value.format === 'learning-companion/video-explanation' &&
    value.version === 1 &&
    isRequiredText(value.sourceRevision, 256) &&
    isRequiredText(value.question) &&
    (value.conversationId === undefined ||
      isRequiredText(value.conversationId, 160))
  );
}

export function isListVideoExplanationsRequest(
  value: unknown,
): value is ListVideoExplanationsRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256) &&
    isRequiredText(value.sourceRevision, 256)
  );
}

export function isVideoExplanationIdRequest(
  value: unknown,
): value is VideoExplanationIdRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256) &&
    (value.kind === 'task' || value.kind === 'attachment') &&
    isRequiredText(value.explanationId, 256)
  );
}

export function isVideoExplanationView(
  value: unknown,
): value is VideoExplanationView {
  return (
    isRecord(value) &&
    isRequiredText(value.id, 256) &&
    isRequiredText(value.projectId, 256) &&
    isRequiredText(value.assetId, 256) &&
    isVideoFrameRegionTarget(value.target) &&
    isRequiredText(value.sourceRevision, 256) &&
    isRequiredText(value.question) &&
    (value.conversationId === undefined ||
      isRequiredText(value.conversationId, 160)) &&
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

export function isVideoExplanationEvent(
  value: unknown,
): value is VideoExplanationEvent {
  if (!isRecord(value)) return false;
  if (value.type === 'changed') {
    return isVideoExplanationView(value.explanation);
  }
  if (value.type === 'replaced') {
    return (
      isRequiredText(value.projectId, 256) &&
      isRequiredText(value.assetId, 256) &&
      isRequiredText(value.previousExplanationId, 256) &&
      isVideoExplanationView(value.explanation) &&
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

export function sameVideoExplanationTarget(
  left: VideoFrameRegionTarget,
  right: VideoFrameRegionTarget,
): boolean {
  const a = left.targetPayload;
  const b = right.targetPayload;
  return (
    a.timeSeconds === b.timeSeconds &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.sourceWidth === b.sourceWidth &&
    a.sourceHeight === b.sourceHeight
  );
}
