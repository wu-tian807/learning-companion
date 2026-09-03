import type { JsonValue } from '../../../shared/workbench/protocol';
import { parseAssetTarget } from '../../../shared/workbench/asset-target';
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

export function parseImageConversationContext(
  value: unknown,
): ImageConversationContext | undefined {
  if (!isRecord(value)) return undefined;
  const target = parseAssetTarget(value.target);
  if (!target) return undefined;
  const normalized = {
    sourceRevision: value.sourceRevision,
    target,
  };
  return isImageConversationContext(normalized)
    ? Object.freeze(normalized) as ImageConversationContext
    : undefined;
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
