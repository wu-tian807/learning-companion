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
export const HTML_DOM_ANCHOR_TYPE = 'html.dom';
export const HTML_DOM_ANCHOR_VERSION = 1;
/** @deprecated Kept only for persisted anchors created before html.dom. */
export const HTML_QUOTE_ANCHOR_TYPE = 'html.quote';
export const HTML_QUOTE_ANCHOR_VERSION = 1;
export const HTML_LINK_ANCHOR_TYPE = 'html.link';
export const HTML_LINK_ANCHOR_VERSION = 1;
/** @deprecated Kept only for persisted anchors created before html.dom. */
export const HTML_ELEMENT_ANCHOR_TYPE = 'html.element';
export const HTML_ELEMENT_ANCHOR_VERSION = 1;

export const htmlFrameCommands = {
  installSourceCopy: 'html.frame.install-source-copy',
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
    HTML_DOM_ANCHOR_TYPE,
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
  readonly editing?: HtmlEditingStatus;
}

export interface HtmlEditingStatus {
  readonly editable: boolean;
  readonly hasDraft: boolean;
  readonly unsynced: boolean;
  readonly syncRequested: boolean;
  readonly pending: boolean;
  readonly stepCount: number;
  readonly changeCount: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly conflict: string | null;
  readonly draftRevision: string;
}

export interface HtmlDraftReviewChange {
  readonly before: string;
  readonly after: string;
}

export interface HtmlDraftReviewEntry {
  readonly taskId: string;
  readonly changes: readonly HtmlDraftReviewChange[];
}

export interface HtmlDraftReview {
  readonly entries: readonly HtmlDraftReviewEntry[];
  readonly pendingChanges: readonly HtmlDraftReviewChange[];
}

const HTML_DRAFT_REVIEW_BEFORE_LIMIT = 2_097_152;
const HTML_DRAFT_REVIEW_AFTER_LIMIT = 1_048_576;

export const htmlEditCommands = {
  status: 'html.edit.status',
  review: 'html.edit.review',
  undo: 'html.edit.undo',
  redo: 'html.edit.redo',
  sync: 'html.edit.sync',
  discard: 'html.edit.discard',
} as const;

export const htmlEditEvents = {
  started: 'html.agent-edit.started',
  rejected: 'html.agent-edit.rejected',
  ended: 'html.agent-edit.ended',
  applied: 'html.agent-edit.applied',
  sessionChanged: 'html.agent-edit.session-changed',
} as const;

export interface HtmlDomElementV1 {
  /** Element-only indexes from document.documentElement to this element. */
  readonly path: readonly number[];
  readonly tagName: string;
  readonly id?: string;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly textQuote?: string;
}

/**
 * The single persisted DOM anchor used by new HTML interactions.
 * Text selection is only a gesture for choosing this element. Exact text
 * ranges and viewport rectangles intentionally stay out of the persisted
 * anchor, so click and drag selection share the same locator.
 */
export interface HtmlDomAnchorV1 {
  readonly frameUrl: string;
  readonly element: HtmlDomElementV1;
}

export interface HtmlQuoteAnchorV1 {
  readonly exact: string;
  readonly frameUrl?: string;
  /** Stable DOM boundary captured from the original Selection Range. */
  readonly domRange?: HtmlDomRangeV1;
  /** 选区在 frame 内的视口矩形（用于 renderer 定位悬浮条/标注）。 */
  readonly rect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface HtmlDomPointV1 {
  /** childNodes indexes from document.documentElement to the boundary node. */
  readonly path: readonly number[];
  readonly offset: number;
}

export interface HtmlDomRangeV1 {
  readonly start: HtmlDomPointV1;
  readonly end: HtmlDomPointV1;
}

export interface HtmlLinkAnchorV1 {
  readonly url: string;
}

export interface HtmlElementAnchorV1 {
  readonly frameUrl: string;
  readonly tagName: string;
  readonly domPath: readonly number[];
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
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
    value.contentUrl.startsWith('learning-content://resource/') &&
    (value.editing === undefined || isHtmlEditingStatus(value.editing))
  );
}

export function isHtmlEditingStatus(value: unknown): value is HtmlEditingStatus {
  return (
    isRecord(value) &&
    typeof value.editable === 'boolean' &&
    typeof value.hasDraft === 'boolean' &&
    typeof value.unsynced === 'boolean' &&
    typeof value.syncRequested === 'boolean' &&
    typeof value.pending === 'boolean' &&
    Number.isSafeInteger(value.stepCount) &&
    Number(value.stepCount) >= 0 &&
    Number.isSafeInteger(value.changeCount) &&
    Number(value.changeCount) >= 0 &&
    typeof value.canUndo === 'boolean' &&
    typeof value.canRedo === 'boolean' &&
    (value.conflict === null || typeof value.conflict === 'string') &&
    typeof value.draftRevision === 'string' &&
    value.draftRevision.length > 0
  );
}

function isHtmlDraftReviewChange(
  value: unknown,
): value is HtmlDraftReviewChange {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === 'before' || key === 'after') &&
    typeof value.before === 'string' &&
    value.before.length <= HTML_DRAFT_REVIEW_BEFORE_LIMIT &&
    typeof value.after === 'string' &&
    value.after.length <= HTML_DRAFT_REVIEW_AFTER_LIMIT
  );
}

export function isHtmlDraftReview(value: unknown): value is HtmlDraftReview {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) => key === 'entries' || key === 'pendingChanges',
    ) &&
    Array.isArray(value.entries) &&
    value.entries.length <= 20 &&
    value.entries.every(
      (entry) =>
        isRecord(entry) &&
        Object.keys(entry).every(
          (key) => key === 'taskId' || key === 'changes',
        ) &&
        typeof entry.taskId === 'string' &&
        entry.taskId.length > 0 &&
        entry.taskId.length <= 256 &&
        Array.isArray(entry.changes) &&
        entry.changes.length > 0 &&
        entry.changes.length <= 1_000 &&
        entry.changes.every(isHtmlDraftReviewChange),
    ) &&
    Array.isArray(value.pendingChanges) &&
    value.pendingChanges.length <= 1_000 &&
    value.pendingChanges.every(isHtmlDraftReviewChange)
  );
}

export function isHtmlQuoteAnchorV1(
  value: unknown,
): value is HtmlQuoteAnchorV1 {
  if (!isRecord(value)) {
    return false;
  }

  const allowedKeys = new Set([
    'exact',
    'frameUrl',
    'domRange',
    'rect',
  ]);

  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    isBoundedText(value.exact, 16_384) &&
    (value.frameUrl === undefined ||
      isBoundedText(value.frameUrl, 8_192)) &&
    (value.domRange === undefined || isHtmlDomRangeV1(value.domRange)) &&
    (value.rect === undefined || isRectValue(value.rect))
  );
}

export function isHtmlDomAnchorV1(
  value: unknown,
): value is HtmlDomAnchorV1 {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) => key === 'frameUrl' || key === 'element',
    ) &&
    isBoundedText(value.frameUrl, 8_192) &&
    isHtmlDomElementV1(value.element)
  );
}

export function isHtmlDomElementV1(
  value: unknown,
): value is HtmlDomElementV1 {
  if (!isRecord(value)) {
    return false;
  }

  const allowedKeys = new Set([
    'path',
    'tagName',
    'id',
    'role',
    'ariaLabel',
    'textQuote',
  ]);

  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    isDomPath(value.path) &&
    typeof value.tagName === 'string' &&
    /^[a-z][a-z0-9-]*$/.test(value.tagName) &&
    (value.id === undefined || isBoundedText(value.id, 512)) &&
    (value.role === undefined || isBoundedText(value.role, 128)) &&
    (value.ariaLabel === undefined || isBoundedText(value.ariaLabel, 512)) &&
    (value.textQuote === undefined || isBoundedText(value.textQuote, 1_024))
  );
}

export function isHtmlDomRangeV1(
  value: unknown,
): value is HtmlDomRangeV1 {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isHtmlDomPointV1(value.start) &&
    isHtmlDomPointV1(value.end)
  );
}

function isHtmlDomPointV1(value: unknown): value is HtmlDomPointV1 {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    Array.isArray(value.path) &&
    value.path.length <= 128 &&
    value.path.every(
      (index) =>
        Number.isSafeInteger(index) && index >= 0 && index <= 100_000,
    ) &&
    typeof value.offset === 'number' &&
    Number.isSafeInteger(value.offset) &&
    value.offset >= 0 &&
    value.offset <= 1_000_000
  );
}

function isDomPath(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every(
      (index) =>
        Number.isSafeInteger(index) && index >= 0 && index <= 100_000,
    )
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
    'rect',
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
    isDomPath(value.domPath) &&
    isRectValue(value.rect) &&
    (value.id === undefined || isBoundedText(value.id, 512)) &&
    (value.role === undefined || isBoundedText(value.role, 128)) &&
    (value.ariaLabel === undefined ||
      isBoundedText(value.ariaLabel, 512)) &&
    (value.textQuote === undefined ||
      isBoundedText(value.textQuote, 1_024))
  );
}

function isRectValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    typeof value.width === 'number' &&
    Number.isFinite(value.width) &&
    typeof value.height === 'number' &&
    Number.isFinite(value.height) &&
    value.x >= -100_000 &&
    value.x <= 100_000 &&
    value.y >= -100_000 &&
    value.y <= 100_000 &&
    value.width >= 0 &&
    value.width <= 100_000 &&
    value.height >= 0 &&
    value.height <= 100_000
  );
}

export function createHtmlQuoteTarget(
  exact: string,
  frameUrl?: string,
  rect?: HtmlQuoteAnchorV1['rect'],
  locator?: Pick<
    HtmlQuoteAnchorV1,
    'domRange'
  >,
): JsonValue & ContentAnchorTarget {
  return {
    scope: 'content',
    anchorType: HTML_QUOTE_ANCHOR_TYPE,
    anchorVersion: HTML_QUOTE_ANCHOR_VERSION,
    anchorPayload: {
      exact,
      ...(frameUrl ? { frameUrl } : {}),
      ...(locator?.domRange
        ? {
            domRange: {
              start: {
                path: [...locator.domRange.start.path],
                offset: locator.domRange.start.offset,
              },
              end: {
                path: [...locator.domRange.end.path],
                offset: locator.domRange.end.offset,
              },
            },
          }
        : {}),
      ...(rect ? { rect } : {}),
    },
  };
}

export function createHtmlDomTarget(
  anchor: HtmlDomAnchorV1,
): JsonValue & ContentAnchorTarget {
  if (!isHtmlDomAnchorV1(anchor)) {
    throw new Error('HTML DOM Anchor 无效');
  }

  return {
    scope: 'content',
    anchorType: HTML_DOM_ANCHOR_TYPE,
    anchorVersion: HTML_DOM_ANCHOR_VERSION,
    anchorPayload: {
      frameUrl: anchor.frameUrl,
      element: {
        path: [...anchor.element.path],
        tagName: anchor.element.tagName,
        ...(anchor.element.id ? { id: anchor.element.id } : {}),
        ...(anchor.element.role ? { role: anchor.element.role } : {}),
        ...(anchor.element.ariaLabel
          ? { ariaLabel: anchor.element.ariaLabel }
          : {}),
        ...(anchor.element.textQuote
          ? { textQuote: anchor.element.textQuote }
          : {}),
      },
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
      rect: {
        x: anchor.rect.x,
        y: anchor.rect.y,
        width: anchor.rect.width,
        height: anchor.rect.height,
      },
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

export function isHtmlDomTarget(
  value: unknown,
): value is JsonValue & ContentAnchorTarget {
  return isHtmlTarget(
    value,
    HTML_DOM_ANCHOR_TYPE,
    HTML_DOM_ANCHOR_VERSION,
    isHtmlDomAnchorV1,
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
