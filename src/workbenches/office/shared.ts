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
import {
  clonePdfWorkbenchState,
  DEFAULT_PDF_WORKBENCH_STATE,
  isPdfWorkbenchStateV1,
  type PdfWorkbenchViewState,
} from '../pdf/shared';

export const OFFICE_WORKBENCH_ID = 'builtin.office';
export const OFFICE_STATE_SCHEMA_VERSION = 1;
export const OFFICE_TEXT_RANGE_ANCHOR_TYPE =
  'office.preview.text-range';
export const OFFICE_PAGE_ANCHOR_TYPE = 'office.preview.page';
export const OFFICE_REGION_ANCHOR_TYPE = 'office.preview.region';
export const OFFICE_ANCHOR_VERSION = 1;

export const OFFICE_MEDIA_TYPES = [
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const officeWorkbenchManifest: AssetWorkbenchManifest<
  typeof OFFICE_WORKBENCH_ID
> = {
  id: OFFICE_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: OFFICE_MEDIA_TYPES,
  requiredContentCapabilities: ['read-stream'],
  supportedTargetTypes: [
    OFFICE_TEXT_RANGE_ANCHOR_TYPE,
    OFFICE_PAGE_ANCHOR_TYPE,
    OFFICE_REGION_ANCHOR_TYPE,
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

export const DEFAULT_OFFICE_WORKBENCH_STATE =
  DEFAULT_PDF_WORKBENCH_STATE;

export type OfficeWorkbenchPayload =
  | {
      readonly status: 'ready';
      readonly contentUrl: string;
      readonly viewState: PdfWorkbenchViewState;
    }
  | {
      readonly status: 'runtime-required' | 'conversion-required';
      readonly viewState: PdfWorkbenchViewState;
    };

export interface OfficePreparePreviewResult {
  readonly status: 'ready';
  readonly contentUrl: string;
  readonly viewState: PdfWorkbenchViewState;
}

export interface OfficeSaveViewStatePayload {
  readonly viewState: PdfWorkbenchViewState;
}

export interface OfficeSaveViewStateResult {
  readonly saved: true;
  readonly savedTime: number;
}

export const officeCommands = {
  preparePreview: 'office:prepare-preview',
  saveViewState: 'office:save-view-state',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isContentUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^learning-content:\/\/resource\/[^/?#]+$/u.test(value)
  );
}

export function isOfficeMediaType(value: string): boolean {
  return (OFFICE_MEDIA_TYPES as readonly string[]).includes(value);
}

export function isOfficeWorkbenchPayload(
  value: unknown,
): value is JsonValue & OfficeWorkbenchPayload {
  if (
    !isRecord(value) ||
    !isPdfWorkbenchStateV1(value.viewState)
  ) {
    return false;
  }

  return value.status === 'ready'
    ? isContentUrl(value.contentUrl)
    : value.status === 'runtime-required' ||
        value.status === 'conversion-required';
}

export function isOfficePreparePreviewResult(
  value: unknown,
): value is JsonValue & OfficePreparePreviewResult {
  return (
    isRecord(value) &&
    value.status === 'ready' &&
    isContentUrl(value.contentUrl) &&
    isPdfWorkbenchStateV1(value.viewState)
  );
}

export function isOfficeSaveViewStatePayload(
  value: unknown,
): value is JsonValue & OfficeSaveViewStatePayload {
  return (
    isRecord(value) &&
    isPdfWorkbenchStateV1(value.viewState)
  );
}

export function isOfficeSaveViewStateResult(
  value: unknown,
): value is JsonValue & OfficeSaveViewStateResult {
  return (
    isRecord(value) &&
    value.saved === true &&
    typeof value.savedTime === 'number' &&
    Number.isSafeInteger(value.savedTime) &&
    value.savedTime >= 0
  );
}

export function createOfficePreparePreviewCommand(): WorkbenchCommand {
  return {
    type: officeCommands.preparePreview,
  };
}

export function createOfficeSaveViewStateCommand(
  viewState: PdfWorkbenchViewState,
): WorkbenchCommand {
  return {
    type: officeCommands.saveViewState,
    payload: {
      viewState: clonePdfWorkbenchState(viewState),
    },
  };
}
