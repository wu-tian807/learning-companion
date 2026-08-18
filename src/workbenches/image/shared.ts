import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import {
  CORE_RENDERER_TRANSPORT_FACILITY_ID,
  createContextMenuSurfaceFacilityDeclaration,
  overflowSurfaceFacilityDeclaration,
  rendererTransportFacilityDeclaration,
} from '../../shared/workbench/facilities/core-facilities';
import type {
  JsonValue,
  WorkbenchCommand,
} from '../../shared/workbench/protocol';

export const IMAGE_WORKBENCH_ID = 'builtin.image';
export const IMAGE_STATE_SCHEMA_VERSION = 1;
export const IMAGE_VIEWPORT_ANCHOR_TYPE = 'image.viewport';
export const IMAGE_VIEWPORT_ANCHOR_VERSION = 1;
export const IMAGE_REGION_ANCHOR_TYPE = 'image.region';
export const IMAGE_REGION_ANCHOR_VERSION = 1;

export const imageWorkbenchManifest: AssetWorkbenchManifest<
  typeof IMAGE_WORKBENCH_ID
> = {
  id: IMAGE_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/bmp',
  ],
  requiredContentCapabilities: ['read-stream'],
  supportedAnchorTypes: [
    IMAGE_VIEWPORT_ANCHOR_TYPE,
    IMAGE_REGION_ANCHOR_TYPE,
  ],
  facilities: [
    rendererTransportFacilityDeclaration,
    overflowSurfaceFacilityDeclaration,
    createContextMenuSurfaceFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
  ],
};

export type ImageWorkbenchViewMode = 'fit' | 'actual-size' | 'manual';
export type ImageWorkbenchRotation = 0 | 90 | 180 | 270;

export interface ImageWorkbenchViewState {
  readonly mode: ImageWorkbenchViewMode;
  readonly centerX: number;
  readonly centerY: number;
  readonly scale: number;
  readonly rotation: ImageWorkbenchRotation;
}

export interface ImageWorkbenchStateV1 {
  readonly viewState: ImageWorkbenchViewState;
}

export interface ImageWorkbenchPayload {
  readonly contentUrl: string;
  readonly viewState: ImageWorkbenchViewState;
}

export interface ImageRegionAnchorV1 {
  /** Normalized coordinates in the unrotated source-image coordinate space. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface ImageRegionTarget extends ContentAnchorTarget {
  readonly anchorType: typeof IMAGE_REGION_ANCHOR_TYPE;
  readonly anchorVersion: typeof IMAGE_REGION_ANCHOR_VERSION;
  readonly anchorPayload: JsonValue & ImageRegionAnchorV1;
}

export interface ImageSaveViewStatePayload {
  readonly viewState: ImageWorkbenchViewState;
}

export interface ImageSaveViewStateResult {
  readonly saved: true;
  readonly savedTime: number;
}

export const DEFAULT_IMAGE_VIEW_STATE: ImageWorkbenchViewState =
  Object.freeze({
    mode: 'fit',
    centerX: 0.5,
    centerY: 0.5,
    scale: 1,
    rotation: 0,
  });

export const imageCommands = {
  saveViewState: 'image:save-view-state',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function cloneImageViewState(
  state: ImageWorkbenchViewState,
): JsonValue & ImageWorkbenchViewState {
  return {
    mode: state.mode,
    centerX: state.centerX,
    centerY: state.centerY,
    scale: state.scale,
    rotation: state.rotation,
  };
}

export function isImageWorkbenchViewState(
  value: unknown,
): value is ImageWorkbenchViewState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.mode === 'fit' ||
      value.mode === 'actual-size' ||
      value.mode === 'manual') &&
    isFiniteInRange(value.centerX, -10, 10) &&
    isFiniteInRange(value.centerY, -10, 10) &&
    isFiniteInRange(value.scale, 0.01, 64) &&
    (value.rotation === 0 ||
      value.rotation === 90 ||
      value.rotation === 180 ||
      value.rotation === 270)
  );
}

export function isImageWorkbenchStateV1(
  value: unknown,
): value is ImageWorkbenchStateV1 {
  return isRecord(value) && isImageWorkbenchViewState(value.viewState);
}

export function isImageWorkbenchPayload(
  value: unknown,
): value is JsonValue & ImageWorkbenchPayload {
  return (
    isRecord(value) &&
    typeof value.contentUrl === 'string' &&
    value.contentUrl.startsWith('learning-content://resource/') &&
    isImageWorkbenchViewState(value.viewState)
  );
}

export function isImageSaveViewStatePayload(
  value: unknown,
): value is JsonValue & ImageSaveViewStatePayload {
  return isRecord(value) && isImageWorkbenchViewState(value.viewState);
}

export function isImageSaveViewStateResult(
  value: unknown,
): value is JsonValue & ImageSaveViewStateResult {
  return (
    isRecord(value) &&
    value.saved === true &&
    typeof value.savedTime === 'number' &&
    Number.isSafeInteger(value.savedTime) &&
    value.savedTime >= 0
  );
}

export function createImageSaveViewStateCommand(
  viewState: ImageWorkbenchViewState,
): WorkbenchCommand {
  return {
    type: imageCommands.saveViewState,
    payload: {
      viewState: cloneImageViewState(viewState),
    },
  };
}

export function createImageViewportTarget(
  viewState: ImageWorkbenchViewState,
): ContentAnchorTarget {
  return {
    scope: 'content',
    anchorType: IMAGE_VIEWPORT_ANCHOR_TYPE,
    anchorVersion: IMAGE_VIEWPORT_ANCHOR_VERSION,
    anchorPayload: cloneImageViewState(viewState),
  };
}

export function isImageRegionAnchorV1(
  value: unknown,
): value is ImageRegionAnchorV1 {
  if (!isRecord(value)) {
    return false;
  }

  const coordinatesAreValid =
    isFiniteInRange(value.x, 0, 1) &&
    isFiniteInRange(value.y, 0, 1) &&
    isFiniteInRange(value.width, 0.000001, 1) &&
    isFiniteInRange(value.height, 0.000001, 1) &&
    value.x + value.width <= 1.000001 &&
    value.y + value.height <= 1.000001;

  return (
    coordinatesAreValid &&
    typeof value.sourceWidth === 'number' &&
    Number.isSafeInteger(value.sourceWidth) &&
    value.sourceWidth > 0 &&
    value.sourceWidth <= 1_000_000 &&
    typeof value.sourceHeight === 'number' &&
    Number.isSafeInteger(value.sourceHeight) &&
    value.sourceHeight > 0 &&
    value.sourceHeight <= 1_000_000
  );
}

export function createImageRegionTarget(
  anchor: ImageRegionAnchorV1,
): ImageRegionTarget {
  if (!isImageRegionAnchorV1(anchor)) {
    throw new Error('图片兴趣区域数据无效');
  }

  return {
    scope: 'content',
    anchorType: IMAGE_REGION_ANCHOR_TYPE,
    anchorVersion: IMAGE_REGION_ANCHOR_VERSION,
    anchorPayload: {
      x: anchor.x,
      y: anchor.y,
      width: anchor.width,
      height: anchor.height,
      sourceWidth: anchor.sourceWidth,
      sourceHeight: anchor.sourceHeight,
    },
  };
}
