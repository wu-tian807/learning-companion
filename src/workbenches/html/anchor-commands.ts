import type { JsonValue } from '../../shared/workbench/protocol';
import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import { isHtmlElementTarget, isHtmlLinkTarget, isHtmlQuoteTarget } from './shared';

export const htmlAnchorCommands = {
  highlight: 'html.anchor.highlight',
  clear: 'html.anchor.clear',
} as const;

export interface HtmlAnchorHighlightCommandPayload {
  readonly target: HtmlAnchorTarget;
  readonly revision: number;
  readonly reveal: boolean;
  readonly durationMs: number;
}

export interface HtmlAnchorClearCommandPayload {
  readonly target: HtmlAnchorTarget;
  readonly revision: number;
}

export interface HtmlAnchorCommandResult {
  readonly found: boolean;
}

export type HtmlAnchorTarget = JsonValue & ContentAnchorTarget;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function isHtmlAnchorTarget(
  value: unknown,
): value is HtmlAnchorTarget {
  return (
    isHtmlElementTarget(value) ||
    isHtmlQuoteTarget(value) ||
    isHtmlLinkTarget(value)
  );
}

export function isHtmlAnchorHighlightCommandPayload(
  value: unknown,
): value is HtmlAnchorHighlightCommandPayload {
  return (
    isRecord(value) &&
    isHtmlAnchorTarget(value.target) &&
    isRevision(value.revision) &&
    typeof value.reveal === 'boolean' &&
    Number.isSafeInteger(value.durationMs) &&
    Number(value.durationMs) >= 0 &&
    Number(value.durationMs) <= 60_000
  );
}

export function isHtmlAnchorClearCommandPayload(
  value: unknown,
): value is HtmlAnchorClearCommandPayload {
  return (
    isRecord(value) &&
    isHtmlAnchorTarget(value.target) &&
    isRevision(value.revision)
  );
}

export function isHtmlAnchorCommandResult(
  value: unknown,
): value is JsonValue & HtmlAnchorCommandResult {
  return isRecord(value) && typeof value.found === 'boolean';
}
