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

export const VIDEO_WORKBENCH_ID = 'builtin.video';
export const VIDEO_STATE_SCHEMA_VERSION = 1;
export const VIDEO_TIME_RANGE_ANCHOR_TYPE = 'video.time-range';
export const VIDEO_TIME_RANGE_ANCHOR_VERSION = 1;

export const videoWorkbenchManifest: AssetWorkbenchManifest<
  typeof VIDEO_WORKBENCH_ID
> = {
  id: VIDEO_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
  ],
  requiredContentCapabilities: ['read-stream'],
  supportedAnchorTypes: [VIDEO_TIME_RANGE_ANCHOR_TYPE],
  facilities: [
    rendererTransportFacilityDeclaration,
    overflowSurfaceFacilityDeclaration,
    createContextMenuSurfaceFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
  ],
};

export interface VideoWorkbenchViewState {
  readonly currentTime: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly playbackRate: number;
}

export interface VideoWorkbenchStateV1 {
  readonly viewState: VideoWorkbenchViewState;
}

export interface VideoWorkbenchPayload {
  readonly contentUrl: string;
  readonly viewState: VideoWorkbenchViewState;
}

export interface VideoSaveViewStatePayload {
  readonly viewState: VideoWorkbenchViewState;
}

export interface VideoSaveViewStateResult {
  readonly saved: true;
  readonly savedTime: number;
}

export interface VideoTimeRangeAnchorV1 {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export const DEFAULT_VIDEO_VIEW_STATE: Readonly<VideoWorkbenchViewState> =
  Object.freeze({
    currentTime: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
  });

export const videoCommands = {
  saveViewState: 'video:save-view-state',
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

export function cloneVideoViewState(
  state: VideoWorkbenchViewState,
): JsonValue & VideoWorkbenchViewState {
  return {
    currentTime: state.currentTime,
    volume: state.volume,
    muted: state.muted,
    playbackRate: state.playbackRate,
  };
}

export function isVideoWorkbenchViewState(
  value: unknown,
): value is VideoWorkbenchViewState {
  return (
    isRecord(value) &&
    isFiniteInRange(value.currentTime, 0, 1_000_000_000) &&
    isFiniteInRange(value.volume, 0, 1) &&
    typeof value.muted === 'boolean' &&
    isFiniteInRange(value.playbackRate, 0.25, 4)
  );
}

export function isVideoWorkbenchStateV1(
  value: unknown,
): value is VideoWorkbenchStateV1 {
  return isRecord(value) && isVideoWorkbenchViewState(value.viewState);
}

export function isVideoWorkbenchPayload(
  value: unknown,
): value is JsonValue & VideoWorkbenchPayload {
  return (
    isRecord(value) &&
    typeof value.contentUrl === 'string' &&
    value.contentUrl.startsWith('learning-content://resource/') &&
    isVideoWorkbenchViewState(value.viewState)
  );
}

export function isVideoSaveViewStatePayload(
  value: unknown,
): value is JsonValue & VideoSaveViewStatePayload {
  return isRecord(value) && isVideoWorkbenchViewState(value.viewState);
}

export function isVideoSaveViewStateResult(
  value: unknown,
): value is JsonValue & VideoSaveViewStateResult {
  return (
    isRecord(value) &&
    value.saved === true &&
    typeof value.savedTime === 'number' &&
    Number.isSafeInteger(value.savedTime) &&
    value.savedTime >= 0
  );
}

export function isVideoTimeRangeAnchorV1(
  value: unknown,
): value is VideoTimeRangeAnchorV1 {
  return (
    isRecord(value) &&
    isFiniteInRange(value.startSeconds, 0, 1_000_000_000) &&
    isFiniteInRange(value.endSeconds, 0, 1_000_000_000) &&
    value.endSeconds >= value.startSeconds
  );
}

export function createVideoTimeRangeTarget(
  startSeconds: number,
  endSeconds = startSeconds,
): ContentAnchorTarget {
  return {
    scope: 'content',
    anchorType: VIDEO_TIME_RANGE_ANCHOR_TYPE,
    anchorVersion: VIDEO_TIME_RANGE_ANCHOR_VERSION,
    anchorPayload: {
      startSeconds,
      endSeconds,
    },
  };
}

export function createVideoSaveViewStateCommand(
  viewState: VideoWorkbenchViewState,
): WorkbenchCommand {
  return {
    type: videoCommands.saveViewState,
    payload: {
      viewState: cloneVideoViewState(viewState),
    },
  };
}
