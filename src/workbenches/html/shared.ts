import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import {
  CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
  createContextMenuSurfaceFacilityDeclaration,
  createTextSelectionInputFacilityDeclaration,
  overflowSurfaceFacilityDeclaration,
  sandboxFrameTransportFacilityDeclaration,
} from '../../shared/workbench/facilities/core-facilities';
import type { JsonValue } from '../../shared/workbench/protocol';

export const HTML_WORKBENCH_ID = 'builtin.html';
export const HTML_QUOTE_ANCHOR_TYPE = 'html.quote';
export const HTML_QUOTE_ANCHOR_VERSION = 1;
export const HTML_LINK_ANCHOR_TYPE = 'html.link';
export const HTML_LINK_ANCHOR_VERSION = 1;
export const HTML_ELEMENT_ANCHOR_TYPE = 'html.element';
export const HTML_ELEMENT_ANCHOR_VERSION = 1;

export const htmlConversationCommands = {
  list: 'html.conversations.list',
  append: 'html.conversations.append',
} as const;

export const htmlWorkbenchManifest: AssetWorkbenchManifest<
  typeof HTML_WORKBENCH_ID
> = {
  id: HTML_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: ['text/html'],
  requiredContentCapabilities: ['read-stream'],
  supportedAnchorTypes: [
    HTML_QUOTE_ANCHOR_TYPE,
    HTML_LINK_ANCHOR_TYPE,
    HTML_ELEMENT_ANCHOR_TYPE,
  ],
  facilities: [
    sandboxFrameTransportFacilityDeclaration,
    overflowSurfaceFacilityDeclaration,
    createContextMenuSurfaceFacilityDeclaration(
      CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
    ),
    createTextSelectionInputFacilityDeclaration(
      CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
    ),
  ],
};

export interface HtmlWorkbenchPayload {
  readonly contentUrl: string;
}

export interface HtmlQuoteAnchorV1 {
  readonly exact: string;
  readonly frameUrl?: string;
}

export interface HtmlLinkAnchorV1 {
  readonly url: string;
}

export interface HtmlElementAnchorV1 {
  readonly frameUrl: string;
  readonly tagName: string;
  readonly domPath: readonly number[];
  readonly id?: string;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly textQuote?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedText(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximumLength
  );
}

function isExternalHttpUrl(value: unknown): value is string {
  if (!isBoundedText(value, 8_192) || value !== value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

export function isHtmlWorkbenchPayload(
  value: unknown,
): value is JsonValue & HtmlWorkbenchPayload {
  return (
    isRecord(value) &&
    typeof value.contentUrl === 'string' &&
    value.contentUrl.startsWith('learning-content://resource/')
  );
}

export function isHtmlQuoteAnchorV1(
  value: unknown,
): value is HtmlQuoteAnchorV1 {
  return (
    isRecord(value) &&
    isBoundedText(value.exact, 16_384) &&
    (value.frameUrl === undefined ||
      isBoundedText(value.frameUrl, 8_192))
  );
}

export function isHtmlLinkAnchorV1(
  value: unknown,
): value is HtmlLinkAnchorV1 {
  return isRecord(value) && isExternalHttpUrl(value.url);
}

export function isHtmlElementAnchorV1(
  value: unknown,
): value is HtmlElementAnchorV1 {
  if (!isRecord(value)) {
    return false;
  }

  const allowedKeys = new Set([
    'frameUrl',
    'tagName',
    'domPath',
    'id',
    'role',
    'ariaLabel',
    'textQuote',
  ]);

  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    isBoundedText(value.frameUrl, 8_192) &&
    typeof value.tagName === 'string' &&
    /^[a-z][a-z0-9-]*$/.test(value.tagName) &&
    Array.isArray(value.domPath) &&
    value.domPath.length <= 128 &&
    value.domPath.every(
      (index) =>
        Number.isSafeInteger(index) && index >= 0 && index <= 100_000,
    ) &&
    (value.id === undefined || isBoundedText(value.id, 512)) &&
    (value.role === undefined || isBoundedText(value.role, 128)) &&
    (value.ariaLabel === undefined ||
      isBoundedText(value.ariaLabel, 512)) &&
    (value.textQuote === undefined ||
      isBoundedText(value.textQuote, 1_024))
  );
}

export function createHtmlQuoteTarget(
  exact: string,
  frameUrl?: string,
): JsonValue & ContentAnchorTarget {
  return {
    scope: 'content',
    anchorType: HTML_QUOTE_ANCHOR_TYPE,
    anchorVersion: HTML_QUOTE_ANCHOR_VERSION,
    anchorPayload: {
      exact,
      ...(frameUrl ? { frameUrl } : {}),
    },
  };
}

export function createHtmlLinkTarget(
  url: string,
): JsonValue & ContentAnchorTarget {
  return {
    scope: 'content',
    anchorType: HTML_LINK_ANCHOR_TYPE,
    anchorVersion: HTML_LINK_ANCHOR_VERSION,
    anchorPayload: { url },
  };
}

export function createHtmlElementTarget(
  anchor: HtmlElementAnchorV1,
): JsonValue & ContentAnchorTarget {
  if (!isHtmlElementAnchorV1(anchor)) {
    throw new Error('HTML 元素 Anchor 无效');
  }

  return {
    scope: 'content',
    anchorType: HTML_ELEMENT_ANCHOR_TYPE,
    anchorVersion: HTML_ELEMENT_ANCHOR_VERSION,
    anchorPayload: {
      frameUrl: anchor.frameUrl,
      tagName: anchor.tagName,
      domPath: [...anchor.domPath],
      ...(anchor.id ? { id: anchor.id } : {}),
      ...(anchor.role ? { role: anchor.role } : {}),
      ...(anchor.ariaLabel ? { ariaLabel: anchor.ariaLabel } : {}),
      ...(anchor.textQuote ? { textQuote: anchor.textQuote } : {}),
    },
  };
}

export function isHtmlElementTarget(
  value: unknown,
): value is JsonValue & ContentAnchorTarget {
  return isHtmlTarget(
    value,
    HTML_ELEMENT_ANCHOR_TYPE,
    HTML_ELEMENT_ANCHOR_VERSION,
    isHtmlElementAnchorV1,
  );
}

export function isHtmlQuoteTarget(
  value: unknown,
): value is JsonValue & ContentAnchorTarget {
  return isHtmlTarget(
    value,
    HTML_QUOTE_ANCHOR_TYPE,
    HTML_QUOTE_ANCHOR_VERSION,
    isHtmlQuoteAnchorV1,
  );
}

export function isHtmlLinkTarget(
  value: unknown,
): value is JsonValue & ContentAnchorTarget {
  return isHtmlTarget(
    value,
    HTML_LINK_ANCHOR_TYPE,
    HTML_LINK_ANCHOR_VERSION,
    isHtmlLinkAnchorV1,
  );
}

function isHtmlTarget(
  value: unknown,
  anchorType: string,
  anchorVersion: number,
  validatePayload: (payload: unknown) => boolean,
): value is JsonValue & ContentAnchorTarget {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const target = value as Partial<ContentAnchorTarget>;

  return (
    target.scope === 'content' &&
    target.anchorType === anchorType &&
    target.anchorVersion === anchorVersion &&
    validatePayload(target.anchorPayload)
  );
}
