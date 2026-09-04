import type { ContentAssetTarget } from '../../shared/workbench/asset-target';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import {
  CORE_RENDERER_TRANSPORT_FACILITY_ID,
  createContextMenuSurfaceFacilityDeclaration,
  createTextSelectionInputFacilityDeclaration,
  rendererTransportFacilityDeclaration,
} from '../../shared/workbench/facilities/core-facilities';
import type {
  JsonValue,
  WorkbenchCommand,
} from '../../shared/workbench/protocol';

export const EPUB_WORKBENCH_ID = 'builtin.epub';
export const EPUB_STATE_SCHEMA_VERSION = 1;
export const EPUB_CFI_RANGE_ANCHOR_TYPE = 'epub.cfi-range';
export const EPUB_CFI_RANGE_ANCHOR_VERSION = 1;

export const epubWorkbenchManifest: AssetWorkbenchManifest<
  typeof EPUB_WORKBENCH_ID
> = {
  id: EPUB_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: ['application/epub+zip'],
  requiredContentCapabilities: ['read-stream'],
  supportedTargetTypes: [EPUB_CFI_RANGE_ANCHOR_TYPE],
  facilities: [
    rendererTransportFacilityDeclaration,
    createContextMenuSurfaceFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
    createTextSelectionInputFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
  ],
};

export type EpubFlow = 'paginated' | 'scrolled-doc';
export type EpubTheme = 'dark' | 'light' | 'sepia';

export interface EpubWorkbenchViewState {
  readonly flow: EpubFlow;
  readonly location?: string;
  readonly fontScale: number;
  readonly theme: EpubTheme;
  readonly tocOpen: boolean;
}

export interface EpubWorkbenchStateV1 {
  readonly viewState: EpubWorkbenchViewState;
}

export interface EpubWorkbenchPayload {
  readonly contentUrl: string;
  readonly viewState: EpubWorkbenchViewState;
}

export interface EpubSaveViewStatePayload {
  readonly viewState: EpubWorkbenchViewState;
}

export interface EpubSaveViewStateResult {
  readonly saved: true;
  readonly savedTime: number;
}

export interface EpubCfiRangeAnchorV1 {
  readonly cfiRange: string;
  readonly quote: {
    readonly exact: string;
    readonly prefix: string;
    readonly suffix: string;
  };
}

export interface EpubCfiRangeTarget extends ContentAssetTarget {
  readonly targetType: typeof EPUB_CFI_RANGE_ANCHOR_TYPE;
  readonly targetVersion: typeof EPUB_CFI_RANGE_ANCHOR_VERSION;
  readonly targetPayload: JsonValue & EpubCfiRangeAnchorV1;
}

export const DEFAULT_EPUB_VIEW_STATE: Readonly<EpubWorkbenchViewState> =
  Object.freeze({
    flow: 'paginated',
    fontScale: 1,
    theme: 'dark',
    tocOpen: false,
  });

export const epubCommands = {
  saveViewState: 'epub:save-view-state',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEpubCfi(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 8 &&
    value.length <= 8_192 &&
    value.startsWith('epubcfi(') &&
    value.endsWith(')')
  );
}

export function cloneEpubViewState(
  state: EpubWorkbenchViewState,
): JsonValue & EpubWorkbenchViewState {
  return {
    flow: state.flow,
    ...(state.location ? { location: state.location } : {}),
    fontScale: state.fontScale,
    theme: state.theme,
    tocOpen: state.tocOpen,
  };
}

export function isEpubWorkbenchViewState(
  value: unknown,
): value is EpubWorkbenchViewState {
  return (
    isRecord(value) &&
    (value.flow === 'paginated' || value.flow === 'scrolled-doc') &&
    (value.location === undefined || isEpubCfi(value.location)) &&
    typeof value.fontScale === 'number' &&
    Number.isFinite(value.fontScale) &&
    value.fontScale >= 0.75 &&
    value.fontScale <= 2 &&
    (value.theme === 'dark' ||
      value.theme === 'light' ||
      value.theme === 'sepia') &&
    typeof value.tocOpen === 'boolean'
  );
}

export function isEpubWorkbenchStateV1(
  value: unknown,
): value is EpubWorkbenchStateV1 {
  return isRecord(value) && isEpubWorkbenchViewState(value.viewState);
}

export function isEpubWorkbenchPayload(
  value: unknown,
): value is JsonValue & EpubWorkbenchPayload {
  return (
    isRecord(value) &&
    typeof value.contentUrl === 'string' &&
    value.contentUrl.startsWith('learning-content://resource/') &&
    isEpubWorkbenchViewState(value.viewState)
  );
}

export function isEpubSaveViewStatePayload(
  value: unknown,
): value is JsonValue & EpubSaveViewStatePayload {
  return isRecord(value) && isEpubWorkbenchViewState(value.viewState);
}

export function isEpubSaveViewStateResult(
  value: unknown,
): value is JsonValue & EpubSaveViewStateResult {
  return (
    isRecord(value) &&
    value.saved === true &&
    typeof value.savedTime === 'number' &&
    Number.isSafeInteger(value.savedTime) &&
    value.savedTime >= 0
  );
}

export function isEpubCfiRangeAnchorV1(
  value: unknown,
): value is EpubCfiRangeAnchorV1 {
  if (
    !isRecord(value) ||
    !isEpubCfi(value.cfiRange) ||
    !isRecord(value.quote)
  ) {
    return false;
  }

  return (
    typeof value.quote.exact === 'string' &&
    value.quote.exact.trim().length > 0 &&
    value.quote.exact.length <= 16_384 &&
    typeof value.quote.prefix === 'string' &&
    value.quote.prefix.length <= 256 &&
    typeof value.quote.suffix === 'string' &&
    value.quote.suffix.length <= 256
  );
}

export function isEpubCfiRangeTarget(
  value: unknown,
): value is EpubCfiRangeTarget {
  return (
    isRecord(value) &&
    value.scope === 'content' &&
    value.targetType === EPUB_CFI_RANGE_ANCHOR_TYPE &&
    value.targetVersion === EPUB_CFI_RANGE_ANCHOR_VERSION &&
    isEpubCfiRangeAnchorV1(value.targetPayload)
  );
}

export function createEpubCfiRangeTarget(
  anchor: EpubCfiRangeAnchorV1,
): EpubCfiRangeTarget {
  return {
    scope: 'content',
    targetType: EPUB_CFI_RANGE_ANCHOR_TYPE,
    targetVersion: EPUB_CFI_RANGE_ANCHOR_VERSION,
    targetPayload: {
      cfiRange: anchor.cfiRange,
      quote: {
        exact: anchor.quote.exact,
        prefix: anchor.quote.prefix,
        suffix: anchor.quote.suffix,
      },
    },
  };
}

export function createEpubSaveViewStateCommand(
  viewState: EpubWorkbenchViewState,
): WorkbenchCommand {
  return {
    type: epubCommands.saveViewState,
    payload: {
      viewState: cloneEpubViewState(viewState),
    },
  };
}
