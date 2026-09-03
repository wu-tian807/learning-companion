import type { JsonValue } from '../../../shared/workbench/protocol';
import { parseAssetTarget } from '../../../shared/workbench/asset-target';
import {
  isVideoFrameRegionTarget,
  type VideoFrameRegionTarget,
} from '../shared';

export const VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID = 'video.frame-context';

export type VideoConversationContext = JsonValue & {
  readonly sourceRevision: string;
  readonly target: VideoFrameRegionTarget;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentRevision(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 256
  );
}

export function isVideoConversationContext(
  value: unknown,
): value is VideoConversationContext {
  return (
    isRecord(value) &&
    isContentRevision(value.sourceRevision) &&
    isVideoFrameRegionTarget(value.target)
  );
}

export function parseVideoConversationContext(
  value: unknown,
): VideoConversationContext | undefined {
  if (!isRecord(value)) return undefined;
  const target = parseAssetTarget(value.target);
  if (!target) return undefined;
  const normalized = {
    sourceRevision: value.sourceRevision,
    target,
  };
  return isVideoConversationContext(normalized)
    ? Object.freeze(normalized) as VideoConversationContext
    : undefined;
}

export function createVideoConversationContext(
  target: VideoFrameRegionTarget,
  sourceRevision: string,
): VideoConversationContext {
  const normalizedRevision = sourceRevision.trim();
  if (!isContentRevision(normalizedRevision)) {
    throw new Error('视频内容版本无效');
  }
  return Object.freeze({
    sourceRevision: normalizedRevision,
    target,
  }) as VideoConversationContext;
}


export function areVideoConversationContextsEqual(
  left: VideoConversationContext,
  right: VideoConversationContext,
): boolean {
  const leftRegion = left.target.targetPayload;
  const rightRegion = right.target.targetPayload;
  return (
    left.sourceRevision === right.sourceRevision &&
    leftRegion.timeSeconds === rightRegion.timeSeconds &&
    leftRegion.x === rightRegion.x &&
    leftRegion.y === rightRegion.y &&
    leftRegion.width === rightRegion.width &&
    leftRegion.height === rightRegion.height &&
    leftRegion.sourceWidth === rightRegion.sourceWidth &&
    leftRegion.sourceHeight === rightRegion.sourceHeight
  );
}

export function shouldReleaseVideoConversationContext(
  current: VideoConversationContext | undefined,
  released: VideoConversationContext | undefined,
): boolean {
  return (
    current !== undefined &&
    (released === undefined ||
      areVideoConversationContextsEqual(current, released))
  );
}
