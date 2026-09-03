import type {
  JsonValue,
  WorkbenchCommand,
} from '../../shared/workbench/protocol';
import type { ContentAssetTarget } from '../../shared/workbench/asset-target';
import {
  isHtmlDomTarget,
  isHtmlElementTarget,
  isHtmlLinkTarget,
  isHtmlQuoteTarget,
  type HtmlDomAnchorV1,
  type HtmlQuoteAnchorV1,
} from './shared';

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

export type HtmlAnchorTarget = JsonValue & ContentAssetTarget;

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
    isHtmlDomTarget(value) ||
    isHtmlElementTarget(value) ||
    isHtmlQuoteTarget(value) ||
    isHtmlLinkTarget(value)
  );
}

function payloadOf<T>(target: ContentAssetTarget): T {
  return target.targetPayload as unknown as T;
}

/**
 * Compares the semantic location of two HTML Anchors while deliberately
 * ignoring their viewport rectangles, which change when the chat panel
 * causes the document to reflow.
 */
export function isSameHtmlAnchorLocation(
  left: unknown,
  right: unknown,
): boolean {
  if (isHtmlDomTarget(left) && isHtmlDomTarget(right)) {
    const a = payloadOf<HtmlDomAnchorV1>(left);
    const b = payloadOf<HtmlDomAnchorV1>(right);
    return (
      a.frameUrl === b.frameUrl &&
      a.element.tagName === b.element.tagName &&
      a.element.id === b.element.id &&
      JSON.stringify(a.element.path) === JSON.stringify(b.element.path)
    );
  }
  if (!isHtmlQuoteTarget(left) || !isHtmlQuoteTarget(right)) {
    return false;
  }
  const a = payloadOf<HtmlQuoteAnchorV1>(left);
  const b = payloadOf<HtmlQuoteAnchorV1>(right);
  if (!a.domRange || !b.domRange) {
    return false;
  }
  return (
    a.exact === b.exact &&
    a.frameUrl === b.frameUrl &&
    JSON.stringify(a.domRange) === JSON.stringify(b.domRange)
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

export function createAnchorHighlightCommand(
  target: HtmlAnchorTarget,
  revision: number,
  reveal: boolean,
  durationMs: number,
): WorkbenchCommand {
  return {
    type: htmlAnchorCommands.highlight,
    payload: { target, revision, reveal, durationMs },
  };
}

export function createAnchorClearCommand(
  target: HtmlAnchorTarget,
  revision: number,
): WorkbenchCommand {
  return {
    type: htmlAnchorCommands.clear,
    payload: { target, revision },
  };
}
