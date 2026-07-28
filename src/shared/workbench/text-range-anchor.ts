import type { ContentAnchorTarget } from './anchor';

export interface TextOffsetRange {
  readonly start: number;
  readonly end: number;
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
