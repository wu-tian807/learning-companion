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

export function createHtmlQuoteTarget(
  exact: string,
  frameUrl?: string,
): ContentAnchorTarget {
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
): ContentAnchorTarget {
  return {
    scope: 'content',
    anchorType: HTML_LINK_ANCHOR_TYPE,
    anchorVersion: HTML_LINK_ANCHOR_VERSION,
    anchorPayload: { url },
  };
}
