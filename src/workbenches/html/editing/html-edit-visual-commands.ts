import type { ContentAnchorTarget } from '../../../shared/workbench/anchor';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { isHtmlDomTarget } from '../shared';

export const htmlEditVisualCommands = {
  show: 'html.edit-visual.show',
  clear: 'html.edit-visual.clear',
} as const;

type HtmlDomTarget = JsonValue & ContentAnchorTarget;

export interface HtmlEditVisualShowPayload {
  readonly target: HtmlDomTarget;
  readonly revision: number;
  readonly phase: 'scanning' | 'rejected';
}

export interface HtmlEditVisualClearPayload {
  readonly target: HtmlDomTarget;
  readonly revision: number;
}

export interface HtmlEditVisualResult {
  readonly found: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function isHtmlEditVisualShowPayload(
  value: unknown,
): value is HtmlEditVisualShowPayload {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) => key === 'target' || key === 'revision' || key === 'phase',
    ) &&
    isHtmlDomTarget(value.target) &&
    isRevision(value.revision) &&
    (value.phase === 'scanning' || value.phase === 'rejected')
  );
}

export function isHtmlEditVisualClearPayload(
  value: unknown,
): value is HtmlEditVisualClearPayload {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) => key === 'target' || key === 'revision',
    ) &&
    isHtmlDomTarget(value.target) &&
    isRevision(value.revision)
  );
}

export function isHtmlEditVisualResult(
  value: unknown,
): value is JsonValue & HtmlEditVisualResult {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === 'found') &&
    typeof value.found === 'boolean'
  );
}
