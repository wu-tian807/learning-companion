import type { AssetTarget, ContentAnchorTarget } from './anchor';

export interface TextOffsetRange {
  readonly start: number;
  readonly end: number;
}

interface TextQuoteRange extends TextOffsetRange {
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
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

function firstTextQuoteRange(
  target: AssetTarget | undefined,
): TextQuoteRange | undefined {
  if (target?.scope !== 'content' || !isRecord(target.anchorPayload)) {
    return undefined;
  }
  const first = Array.isArray(target.anchorPayload.ranges)
    ? target.anchorPayload.ranges[0]
    : undefined;
  if (
    !isTextOffsetRange(first) ||
    !isRecord(first) ||
    typeof first.exact !== 'string' ||
    !first.exact
  ) {
    return undefined;
  }
  return {
    start: Number(first.start),
    end: Number(first.end),
    exact: first.exact,
    ...(typeof first.prefix === 'string' ? { prefix: first.prefix } : {}),
    ...(typeof first.suffix === 'string' ? { suffix: first.suffix } : {}),
  };
}

export interface ResolvedTextRangeSelection {
  readonly start: number;
  readonly end: number;
}

/**
 * Resolves a captured source range against current content.
 * Exact offsets are accepted only while their quote still matches; moved
 * content must leave exactly one unambiguous quote/context match.
 */
export function resolveTextRangeSelection(
  source: string,
  target: AssetTarget | undefined,
): ResolvedTextRangeSelection | undefined {
  const quote = firstTextQuoteRange(target);
  if (!quote) return undefined;
  if (
    quote.end <= source.length &&
    source.slice(quote.start, quote.end) === quote.exact
  ) {
    return { start: quote.start, end: quote.end };
  }

  const starts = allQuoteStarts(source, quote.exact);
  if (starts.length === 1) {
    const start = starts[0]!;
    return { start, end: start + quote.exact.length };
  }
  const contextual = starts.filter((start) =>
    matchesQuoteContext(source, start, quote),
  );
  return contextual.length === 1
    ? { start: contextual[0]!, end: contextual[0]! + quote.exact.length }
    : undefined;
}

function allQuoteStarts(source: string, exact: string): readonly number[] {
  const starts: number[] = [];
  let from = 0;
  while (from <= source.length - exact.length) {
    const found = source.indexOf(exact, from);
    if (found < 0) break;
    starts.push(found);
    from = found + 1;
  }
  return starts;
}

function matchesQuoteContext(
  source: string,
  start: number,
  quote: TextQuoteRange,
): boolean {
  const prefixMatches =
    !quote.prefix ||
    source.slice(Math.max(0, start - quote.prefix.length), start) ===
      quote.prefix;
  const end = start + quote.exact.length;
  const suffixMatches =
    !quote.suffix ||
    source.slice(end, end + quote.suffix.length) === quote.suffix;
  return prefixMatches && suffixMatches;
}

/**
 * Resolves the end of a captured source range against current content.
 * Stale offsets are accepted only when their quote is still exact; moved
 * content must have one unambiguous quote/context match. Visual-only anchors
 * without a source range deliberately cannot authorize source mutation.
 */
export function resolveTextRangeEndOffset(
  source: string,
  target: AssetTarget | undefined,
): number | undefined {
  return resolveTextRangeSelection(source, target)?.end;
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
