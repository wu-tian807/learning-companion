import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  isImageRegionTarget,
  type ImageRegionTarget,
} from './shared';

export const IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID = 'image.context';

export type ImageConversationContext = JsonValue & {
  readonly sourceRevision: string;
  readonly target: ImageRegionTarget;
};

const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9._-]{1,256}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isImageConversationContext(
  value: unknown,
): value is ImageConversationContext {
  return (
    isRecord(value) &&
    typeof value.sourceRevision === 'string' &&
    SOURCE_REVISION_PATTERN.test(value.sourceRevision) &&
    isImageRegionTarget(value.target)
  );
}

export function createImageConversationContext(
  target: ImageRegionTarget,
  sourceRevision: string,
): ImageConversationContext {
  const normalizedRevision = sourceRevision.trim();
  if (!SOURCE_REVISION_PATTERN.test(normalizedRevision)) {
    throw new Error('图片内容版本无效');
  }
  return Object.freeze({
    sourceRevision: normalizedRevision,
    target,
  }) as ImageConversationContext;
}

export function describeImageConversationContext(context: JsonValue) {
  if (!isImageConversationContext(context)) return { label: '图片兴趣区域' };
  const region = context.target.anchorPayload;
  return {
    label: '图片兴趣区域',
    detail: `左侧 ${Math.round(region.x * 100)}% · 顶部 ${Math.round(region.y * 100)}% · ${Math.round(region.width * 100)}% × ${Math.round(region.height * 100)}%`,
  };
}
