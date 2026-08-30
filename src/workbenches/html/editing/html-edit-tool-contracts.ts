import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  HTML_DOM_ANCHOR_TYPE,
  HTML_DOM_ANCHOR_VERSION,
  isHtmlDomTarget,
  type HtmlDomAnchorV1,
} from '../shared';
import { HTML_EDIT_LIMITS, type HtmlEditScope } from './html-document-parser';

export const HTML_BEGIN_EDIT_TOOL_ID = 'html_begin_edit';
export const HTML_REPLACE_EDIT_TOOL_ID = 'html_replace_edit';

export type HtmlBeginEditInput = {
  readonly locator:
    | { readonly kind: 'selector'; readonly selector: string }
    | {
        readonly kind: 'dom-anchor';
        readonly target: JsonValue;
      };
  readonly scope: HtmlEditScope;
};

export interface HtmlReplaceEditInput {
  readonly editId: string;
  readonly html: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseHtmlBeginEditInput(
  value: unknown,
): HtmlBeginEditInput | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'locator' && key !== 'scope') ||
    (value.scope !== 'contents' && value.scope !== 'element')
  ) {
    return undefined;
  }
  const locator = value.locator;
  if (!isRecord(locator)) {
    return undefined;
  }
  if (
    locator.kind === 'selector' &&
    typeof locator.selector === 'string' &&
    locator.selector.trim().length > 0 &&
    locator.selector.length <= HTML_EDIT_LIMITS.selectorLength &&
    Object.keys(locator).every((key) => key === 'kind' || key === 'selector')
  ) {
    return { scope: value.scope, locator: { kind: 'selector', selector: locator.selector } };
  }
  if (
    locator.kind === 'dom-anchor' &&
    isHtmlDomTarget(locator.target) &&
    Object.keys(locator).every((key) => key === 'kind' || key === 'target')
  ) {
    return { scope: value.scope, locator: { kind: 'dom-anchor', target: locator.target } };
  }
  return undefined;
}

export function parseHtmlReplaceEditInput(
  value: unknown,
): HtmlReplaceEditInput | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'editId' && key !== 'html') ||
    typeof value.editId !== 'string' ||
    value.editId.trim().length === 0 ||
    value.editId.length > 256 ||
    typeof value.html !== 'string' ||
    value.html.length > HTML_EDIT_LIMITS.replacementLength
  ) {
    return undefined;
  }
  return { editId: value.editId, html: value.html };
}

export function htmlDomAnchorFromTarget(target: JsonValue): HtmlDomAnchorV1 {
  if (!isHtmlDomTarget(target)) {
    throw new Error('HTML DOM target 无效');
  }
  return target.anchorPayload as unknown as HtmlDomAnchorV1;
}

export const HTML_BEGIN_EDIT_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['locator', 'scope'],
  properties: {
    locator: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'selector'],
          properties: {
            kind: { const: 'selector' },
            selector: { type: 'string', minLength: 1, maxLength: HTML_EDIT_LIMITS.selectorLength },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'target'],
          properties: {
            kind: { const: 'dom-anchor' },
            target: {
              type: 'object',
              additionalProperties: false,
              required: ['scope', 'anchorType', 'anchorVersion', 'anchorPayload'],
              properties: {
                scope: { const: 'content' },
                anchorType: { const: HTML_DOM_ANCHOR_TYPE },
                anchorVersion: { const: HTML_DOM_ANCHOR_VERSION },
                anchorPayload: { type: 'object' },
              },
            },
          },
        },
      ],
    },
    scope: { type: 'string', enum: ['contents', 'element'] },
  },
}) as unknown as JsonValue;

export const HTML_REPLACE_EDIT_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['editId', 'html'],
  properties: {
    editId: { type: 'string', minLength: 1, maxLength: 256 },
    html: { type: 'string', maxLength: HTML_EDIT_LIMITS.replacementLength },
  },
}) as JsonValue;
