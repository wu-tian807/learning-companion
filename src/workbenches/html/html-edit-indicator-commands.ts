import type { JsonValue } from '../../shared/workbench/protocol';
import { isHtmlDomTarget } from './shared';
import type { HtmlAnchorTarget } from './anchor-commands';

export const htmlEditIndicatorCommands = {
  show: 'html.edit-indicator.show',
  clear: 'html.edit-indicator.clear',
} as const;

export interface HtmlEditIndicatorShowCommandPayload {
  readonly target: HtmlAnchorTarget;
  readonly revision: number;
  readonly phase: 'editing' | 'rejected';
}

export interface HtmlEditIndicatorClearCommandPayload {
  readonly target: HtmlAnchorTarget;
  readonly revision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function isHtmlEditIndicatorShowCommandPayload(
  value: unknown,
): value is HtmlEditIndicatorShowCommandPayload {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) => key === 'target' || key === 'revision' || key === 'phase',
    ) &&
    isHtmlDomTarget(value.target) &&
    isRevision(value.revision) &&
    (value.phase === 'editing' || value.phase === 'rejected')
  );
}

export function isHtmlEditIndicatorClearCommandPayload(
  value: unknown,
): value is HtmlEditIndicatorClearCommandPayload {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) => key === 'target' || key === 'revision',
    ) &&
    isHtmlDomTarget(value.target) &&
    isRevision(value.revision)
  );
}

export function isHtmlEditIndicatorCommandResult(
  value: unknown,
): value is JsonValue & { readonly found: boolean } {
  return isRecord(value) && typeof value.found === 'boolean';
}
