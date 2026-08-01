import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from './protocol';

export interface WholeAssetTarget {
  readonly scope: 'asset';
}

export interface ContentAnchorTarget {
  readonly scope: 'content';
  readonly anchorType: string;
  readonly anchorVersion: number;
  readonly anchorPayload: JsonValue;
}

export type AssetTarget = WholeAssetTarget | ContentAnchorTarget;

export function isAssetTarget(
  value: unknown,
): value is AssetTarget {
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

export function cloneAssetTarget(target: AssetTarget): AssetTarget {
  if (!isAssetTarget(target)) {
    throw new Error('AssetTarget 数据无效');
  }

  if (target.scope === 'asset') {
    return Object.freeze({ scope: 'asset' });
  }

  return Object.freeze({
    scope: 'content',
    anchorType: target.anchorType.trim(),
    anchorVersion: target.anchorVersion,
    anchorPayload: cloneJsonValue(target.anchorPayload),
  });
}
