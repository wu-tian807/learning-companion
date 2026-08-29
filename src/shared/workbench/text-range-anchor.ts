import type { ContentAnchorTarget } from './anchor';

export interface TextOffsetRange {
  readonly start: number;
  readonly end: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTextOffsetRange(value: unknown): value is TextOffsetRange {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.start) &&
    Number.isSafeInteger(value.end) &&
    Number(value.start) >= 0 &&
    Number(value.end) >= Number(value.start)
  );
}

/** 校验 createTextRangeTarget 生成的 anchorPayload（{ ranges: [...] }）。 */
export function isTextRangePayload(
  value: unknown,
): value is { readonly ranges: readonly TextOffsetRange[] } {
  if (!isRecord(value) || !Array.isArray(value.ranges)) return false;
  if (value.ranges.length === 0) return false;
  return value.ranges.every(isTextOffsetRange);
}

const QUOTE_CONTEXT_LENGTH = 64;

export function createTextRangeTarget(
  anchorType: string,
  source: string,
  ranges: readonly TextOffsetRange[],
): ContentAnchorTarget {
  const normalizedRanges = ranges.map(({ start, end }) => {
    const normalizedStart = Math.max(
      0,
      Math.min(Math.trunc(start), source.length),
    );
    const normalizedEnd = Math.max(
      normalizedStart,
      Math.min(Math.trunc(end), source.length),
    );

    return {
      start: normalizedStart,
      end: normalizedEnd,
      exact: source.slice(normalizedStart, normalizedEnd),
      prefix: source.slice(
        Math.max(0, normalizedStart - QUOTE_CONTEXT_LENGTH),
        normalizedStart,
      ),
      suffix: source.slice(
        normalizedEnd,
        normalizedEnd + QUOTE_CONTEXT_LENGTH,
      ),
    };
  });

  return {
    scope: 'content',
    anchorType,
    anchorVersion: 1,
    anchorPayload: {
      ranges: normalizedRanges,
    },
  };
}
