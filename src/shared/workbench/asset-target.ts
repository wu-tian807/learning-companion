import { cloneJsonValue, isJsonValue, type JsonValue } from './protocol';

export interface WholeAssetTarget {
  readonly scope: 'asset';
}

export interface ContentAssetTarget {
  readonly scope: 'content';
  readonly targetType: string;
  readonly targetVersion: number;
  readonly targetPayload: JsonValue;
}

export type AssetTarget = WholeAssetTarget | ContentAssetTarget;

interface LegacyContentAssetTarget {
  readonly scope: 'content';
  readonly anchorType: string;
  readonly anchorVersion: number;
  readonly anchorPayload: JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isTargetIdentity(
  targetType: unknown,
  targetVersion: unknown,
): targetType is string {
  return (
    typeof targetType === 'string' &&
    targetType.trim().length > 0 &&
    typeof targetVersion === 'number' &&
    Number.isSafeInteger(targetVersion) &&
    targetVersion > 0
  );
}

export function isAssetTarget(value: unknown): value is AssetTarget {
  if (!isRecord(value)) {
    return false;
  }

  if (value.scope === 'asset') {
    return hasOnlyKeys(value, ['scope']);
  }

  return (
    value.scope === 'content' &&
    hasOnlyKeys(value, [
      'scope',
      'targetType',
      'targetVersion',
      'targetPayload',
    ]) &&
    isTargetIdentity(value.targetType, value.targetVersion) &&
    value.targetPayload !== undefined &&
    isJsonValue(value.targetPayload)
  );
}

export function parseAssetTarget(value: unknown): AssetTarget | undefined {
  if (isAssetTarget(value)) return cloneAssetTarget(value);
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 4 ||
    !keys.every((key, index) =>
      key === ['anchorPayload', 'anchorType', 'anchorVersion', 'scope'][index],
    ) ||
    value.scope !== 'content' ||
    typeof value.anchorType !== 'string' ||
    value.anchorType.trim().length === 0 ||
    !Number.isSafeInteger(value.anchorVersion) ||
    Number(value.anchorVersion) <= 0 ||
    !isJsonValue(value.anchorPayload)
  ) {
    return undefined;
  }
  const legacy = value as unknown as LegacyContentAssetTarget;
  return Object.freeze({
    scope: 'content',
    targetType: legacy.anchorType.trim(),
    targetVersion: legacy.anchorVersion,
    targetPayload: cloneJsonValue(legacy.anchorPayload),
  });
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
    targetType: target.targetType.trim(),
    targetVersion: target.targetVersion,
    targetPayload: cloneJsonValue(target.targetPayload),
  });
}
