import { isJsonValue, type JsonValue } from './protocol';

export interface AssetTarget {
  readonly scope: 'asset';
}

export interface ContentAnchorTarget {
  readonly scope: 'content';
  readonly anchorType: string;
  readonly anchorVersion: number;
  readonly anchorPayload: JsonValue;
}

export type AssetAttachmentTarget = AssetTarget | ContentAnchorTarget;

export function isAssetAttachmentTarget(
  value: unknown,
): value is AssetAttachmentTarget {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.scope === 'asset') {
    return true;
  }

  return (
    candidate.scope === 'content' &&
    typeof candidate.anchorType === 'string' &&
    candidate.anchorType.trim().length > 0 &&
    typeof candidate.anchorVersion === 'number' &&
    Number.isSafeInteger(candidate.anchorVersion) &&
    candidate.anchorVersion > 0 &&
    candidate.anchorPayload !== undefined &&
    isJsonValue(candidate.anchorPayload)
  );
}
