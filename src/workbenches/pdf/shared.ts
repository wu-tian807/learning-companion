import {
  isAssetTarget,
  type ContentAssetTarget,
} from '../../shared/workbench/asset-target';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import {
  CORE_RENDERER_TRANSPORT_FACILITY_ID,
  createContextMenuSurfaceFacilityDeclaration,
  createTextSelectionInputFacilityDeclaration,
  overflowSurfaceFacilityDeclaration,
  rendererTransportFacilityDeclaration,
} from '../../shared/workbench/facilities/core-facilities';
import type {
  JsonValue,
  WorkbenchCommand,
} from '../../shared/workbench/protocol';

export const PDF_WORKBENCH_ID = 'builtin.pdf';
export const PDF_STATE_SCHEMA_VERSION = 1;
export const PDF_TEXT_RANGE_ANCHOR_TYPE = 'pdf.text-range';
export const PDF_TEXT_RANGE_ANCHOR_VERSION = 1;
export const PDF_PAGE_ANCHOR_TYPE = 'pdf.page';
export const PDF_PAGE_ANCHOR_VERSION = 1;
export const PDF_REGION_ANCHOR_TYPE = 'pdf.region';
export const PDF_REGION_ANCHOR_VERSION = 1;

export const pdfWorkbenchManifest: AssetWorkbenchManifest<
  typeof PDF_WORKBENCH_ID
> = {
  id: PDF_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: ['application/pdf'],
  requiredContentCapabilities: ['read-stream'],
  supportedTargetTypes: [
    PDF_TEXT_RANGE_ANCHOR_TYPE,
    PDF_PAGE_ANCHOR_TYPE,
    PDF_REGION_ANCHOR_TYPE,
  ],
  facilities: [
    rendererTransportFacilityDeclaration,
    overflowSurfaceFacilityDeclaration,
    createContextMenuSurfaceFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
    createTextSelectionInputFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
  ],
};

export type PdfReadingMode = 'continuous' | 'paged';
export type PdfScaleMode =
  | 'page-width'
  | 'page-fit'
  | 'actual-size'
  | 'custom';
export type PdfRotation = 0 | 90 | 180 | 270;
export type PdfSidebar = 'closed' | 'outline' | 'thumbnails';

export interface PdfWorkbenchStateV1 {
  readonly readingMode: PdfReadingMode;
  readonly pageNumber: number;
  readonly pageOffsetRatio: number;
  readonly scaleMode: PdfScaleMode;
  readonly customScale: number;
  readonly rotation: PdfRotation;
  readonly sidebar: PdfSidebar;
}

export type PdfWorkbenchViewState = PdfWorkbenchStateV1;

export interface PdfWorkbenchPayload {
  readonly contentUrl: string;
  readonly viewState: PdfWorkbenchViewState;
}

export interface PdfSaveViewStatePayload {
  readonly viewState: PdfWorkbenchViewState;
}

export interface PdfSaveViewStateResult {
  readonly saved: true;
  readonly savedTime: number;
}

export interface PdfDocumentIdentity {
  readonly fingerprint: string;
  readonly modifiedFingerprint?: string;
}

export interface PdfTextPositionV1 {
  readonly pageNumber: number;
  readonly offset: number;
}

export interface PdfTextRangeAnchorV1 {
  readonly documentIdentity: PdfDocumentIdentity;
  readonly start: PdfTextPositionV1;
  readonly end: PdfTextPositionV1;
  readonly quote: {
    readonly exact: string;
    readonly prefix: string;
    readonly suffix: string;
  };
}

export interface PdfPageAnchorV1 {
  readonly pageNumber: number;
}

export interface PdfRegionAnchorV1 {
  readonly pageNumber: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_PDF_WORKBENCH_STATE:
  Readonly<PdfWorkbenchStateV1> = Object.freeze({
    readingMode: 'continuous',
    pageNumber: 1,
    pageOffsetRatio: 0,
    scaleMode: 'page-width',
    customScale: 1,
    rotation: 0,
    sidebar: 'closed',
  });

export const pdfCommands = {
  saveViewState: 'pdf:save-view-state',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isFiniteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function clonePdfWorkbenchState(
  state: PdfWorkbenchViewState,
): JsonValue & PdfWorkbenchViewState {
  return {
    readingMode: state.readingMode,
    pageNumber: state.pageNumber,
    pageOffsetRatio: state.pageOffsetRatio,
    scaleMode: state.scaleMode,
    customScale: state.customScale,
    rotation: state.rotation,
    sidebar: state.sidebar,
  };
}

export function isPdfWorkbenchStateV1(
  value: unknown,
): value is PdfWorkbenchStateV1 {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.readingMode === 'continuous' ||
      value.readingMode === 'paged') &&
    isPositiveInteger(value.pageNumber) &&
    isFiniteInRange(value.pageOffsetRatio, 0, 1) &&
    (value.scaleMode === 'page-width' ||
      value.scaleMode === 'page-fit' ||
      value.scaleMode === 'actual-size' ||
      value.scaleMode === 'custom') &&
    isFiniteInRange(value.customScale, 0.1, 10) &&
    (value.rotation === 0 ||
      value.rotation === 90 ||
      value.rotation === 180 ||
      value.rotation === 270) &&
    (value.sidebar === 'closed' ||
      value.sidebar === 'outline' ||
      value.sidebar === 'thumbnails')
  );
}

export function isPdfWorkbenchPayload(
  value: unknown,
): value is JsonValue & PdfWorkbenchPayload {
  return (
    isRecord(value) &&
    typeof value.contentUrl === 'string' &&
    /^learning-content:\/\/resource\/[^/?#]+$/.test(value.contentUrl) &&
    isPdfWorkbenchStateV1(value.viewState)
  );
}

export function isPdfSaveViewStatePayload(
  value: unknown,
): value is JsonValue & PdfSaveViewStatePayload {
  return isRecord(value) && isPdfWorkbenchStateV1(value.viewState);
}

export function isPdfSaveViewStateResult(
  value: unknown,
): value is JsonValue & PdfSaveViewStateResult {
  return (
    isRecord(value) &&
    value.saved === true &&
    isNonNegativeInteger(value.savedTime)
  );
}

export function createPdfSaveViewStateCommand(
  viewState: PdfWorkbenchViewState,
): WorkbenchCommand {
  return {
    type: pdfCommands.saveViewState,
    payload: {
      viewState: clonePdfWorkbenchState(viewState),
    },
  };
}

export function isPdfDocumentIdentity(
  value: unknown,
): value is PdfDocumentIdentity {
  return (
    isRecord(value) &&
    isRequiredText(value.fingerprint) &&
    (value.modifiedFingerprint === undefined ||
      isRequiredText(value.modifiedFingerprint))
  );
}

export function createPdfDocumentIdentity(
  fingerprints: readonly [string, string | null],
): JsonValue & PdfDocumentIdentity {
  const [fingerprint, modifiedFingerprint] = fingerprints;
  const identity: JsonValue & PdfDocumentIdentity = modifiedFingerprint
    ? { fingerprint, modifiedFingerprint }
    : { fingerprint };

  if (!isPdfDocumentIdentity(identity)) {
    throw new TypeError('PDF 文档指纹无效');
  }

  return identity;
}

export function isPdfTextPositionV1(
  value: unknown,
): value is PdfTextPositionV1 {
  return (
    isRecord(value) &&
    isPositiveInteger(value.pageNumber) &&
    isNonNegativeInteger(value.offset)
  );
}

function comparePositions(
  left: PdfTextPositionV1,
  right: PdfTextPositionV1,
): number {
  return (
    left.pageNumber - right.pageNumber ||
    left.offset - right.offset
  );
}

export function isPdfTextRangeAnchorV1(
  value: unknown,
): value is PdfTextRangeAnchorV1 {
  if (
    !isRecord(value) ||
    !isPdfDocumentIdentity(value.documentIdentity) ||
    !isPdfTextPositionV1(value.start) ||
    !isPdfTextPositionV1(value.end) ||
    comparePositions(value.start, value.end) >= 0 ||
    !isRecord(value.quote)
  ) {
    return false;
  }

  return (
    typeof value.quote.exact === 'string' &&
    value.quote.exact.length > 0 &&
    typeof value.quote.prefix === 'string' &&
    typeof value.quote.suffix === 'string'
  );
}

export function createPdfTextRangeAnchor(
  value: PdfTextRangeAnchorV1,
): JsonValue & PdfTextRangeAnchorV1 {
  const anchor: JsonValue & PdfTextRangeAnchorV1 = {
    documentIdentity: {
      fingerprint: value.documentIdentity.fingerprint,
      ...(value.documentIdentity.modifiedFingerprint
        ? {
            modifiedFingerprint:
              value.documentIdentity.modifiedFingerprint,
          }
        : {}),
    },
    start: {
      pageNumber: value.start.pageNumber,
      offset: value.start.offset,
    },
    end: {
      pageNumber: value.end.pageNumber,
      offset: value.end.offset,
    },
    quote: {
      exact: value.quote.exact,
      prefix: value.quote.prefix,
      suffix: value.quote.suffix,
    },
  };

  if (!isPdfTextRangeAnchorV1(anchor)) {
    throw new TypeError('PDF 文字选区 Anchor 无效');
  }

  return anchor;
}

export function createPdfTextRangeTarget(
  anchor: PdfTextRangeAnchorV1,
): ContentAssetTarget {
  return {
    scope: 'content',
    targetType: PDF_TEXT_RANGE_ANCHOR_TYPE,
    targetVersion: PDF_TEXT_RANGE_ANCHOR_VERSION,
    targetPayload: createPdfTextRangeAnchor(anchor),
  };
}

export function isPdfPageAnchorV1(
  value: unknown,
): value is PdfPageAnchorV1 {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.pageNumber) &&
    Number(value.pageNumber) >= 1
  );
}

export function createPdfPageTarget(
  pageNumber: number,
): ContentAssetTarget {
  return {
    scope: 'content',
    targetType: PDF_PAGE_ANCHOR_TYPE,
    targetVersion: PDF_PAGE_ANCHOR_VERSION,
    targetPayload: { pageNumber },
  };
}

export function isPdfRegionAnchorV1(
  value: unknown,
): value is PdfRegionAnchorV1 {
  if (!isRecord(value) || !isPositiveInteger(value.pageNumber)) {
    return false;
  }

  const coordinates = [value.x, value.y, value.width, value.height];
  return (
    coordinates.every((coordinate) => isFiniteInRange(coordinate, 0, 1)) &&
    Number(value.width) > 0 &&
    Number(value.height) > 0 &&
    Number(value.x) + Number(value.width) <= 1.000_001 &&
    Number(value.y) + Number(value.height) <= 1.000_001
  );
}

export function createPdfRegionTarget(
  region: PdfRegionAnchorV1,
): ContentAssetTarget {
  if (!isPdfRegionAnchorV1(region)) {
    throw new TypeError('PDF region Anchor is invalid');
  }

  return {
    scope: 'content',
    targetType: PDF_REGION_ANCHOR_TYPE,
    targetVersion: PDF_REGION_ANCHOR_VERSION,
    targetPayload: { ...region },
  };
}

export function isPdfContentTarget(
  value: unknown,
): value is ContentAssetTarget {
  if (!isAssetTarget(value) || value.scope !== 'content') {
    return false;
  }

  return (
    (value.targetType === PDF_TEXT_RANGE_ANCHOR_TYPE &&
      value.targetVersion === PDF_TEXT_RANGE_ANCHOR_VERSION &&
      isPdfTextRangeAnchorV1(value.targetPayload)) ||
    (value.targetType === PDF_PAGE_ANCHOR_TYPE &&
      value.targetVersion === PDF_PAGE_ANCHOR_VERSION &&
      isPdfPageAnchorV1(value.targetPayload)) ||
    (value.targetType === PDF_REGION_ANCHOR_TYPE &&
      value.targetVersion === PDF_REGION_ANCHOR_VERSION &&
      isPdfRegionAnchorV1(value.targetPayload))
  );
}

export function matchesPdfDocumentIdentity(
  anchor: Pick<PdfTextRangeAnchorV1, 'documentIdentity'>,
  identity: PdfDocumentIdentity,
): boolean {
  return (
    anchor.documentIdentity.fingerprint === identity.fingerprint &&
    anchor.documentIdentity.modifiedFingerprint ===
      identity.modifiedFingerprint
  );
}
