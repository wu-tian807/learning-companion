import type { ContentAssetTarget } from '../../shared/workbench/asset-target';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import {
  CORE_RENDERER_TRANSPORT_FACILITY_ID,
  createContextMenuSurfaceFacilityDeclaration,
  headerSurfaceFacilityDeclaration,
  overflowSurfaceFacilityDeclaration,
  rendererTransportFacilityDeclaration,
} from '../../shared/workbench/facilities/core-facilities';
import type {
  JsonValue,
  WorkbenchCommand,
} from '../../shared/workbench/protocol';
import {
  cloneMediaDubbingSnapshot,
  EMPTY_MEDIA_DUBBING_SNAPSHOT,
  isMediaDubbingSnapshot,
  type MediaDubbingPhase,
  type MediaDubbingSnapshot,
} from '../media-dubbing/contracts';
import {
  cloneMediaSubtitleCueFinalPayload,
  cloneMediaSubtitleSnapshot,
  EMPTY_MEDIA_SUBTITLE_SNAPSHOT,
  isMediaSubtitleCueFinalPayload,
  isMediaSubtitleDisplayMode,
  isMediaSubtitleSnapshot,
  isMediaSubtitleViewState,
  type MediaSubtitleCueFinalPayload,
  type MediaSubtitleDisplayMode,
  type MediaSubtitlePhase,
  type MediaSubtitleSnapshot,
  type MediaSubtitleViewState,
} from '../media-subtitles/presentation';

export const VIDEO_WORKBENCH_ID = 'builtin.video';
export const VIDEO_STATE_SCHEMA_VERSION = 2;
export const VIDEO_TIME_RANGE_ANCHOR_TYPE = 'video.time-range';
export const VIDEO_TIME_RANGE_ANCHOR_VERSION = 1;
export const VIDEO_FRAME_REGION_ANCHOR_TYPE = 'video.frame-region';
export const VIDEO_FRAME_REGION_ANCHOR_VERSION = 1;
export const MAX_VIDEO_FRAME_SOURCE_EDGE = 32_768;
export const MAX_VIDEO_FRAME_SOURCE_PIXELS = 100_000_000;

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
  supportedTargetTypes: [
    VIDEO_TIME_RANGE_ANCHOR_TYPE,
    VIDEO_FRAME_REGION_ANCHOR_TYPE,
  ],
  facilities: [
    rendererTransportFacilityDeclaration,
    headerSurfaceFacilityDeclaration,
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

export type VideoSubtitleDisplayMode = MediaSubtitleDisplayMode;
export type VideoSubtitleViewState = MediaSubtitleViewState;

export interface VideoWorkbenchStateV2 {
  readonly viewState: VideoWorkbenchViewState;
  readonly subtitleState: VideoSubtitleViewState;
}

export type VideoSubtitlePhase = MediaSubtitlePhase;
export type VideoSubtitleSnapshot = MediaSubtitleSnapshot;
export type VideoSubtitleCueFinalPayload = MediaSubtitleCueFinalPayload;
export type VideoDubbingPhase = MediaDubbingPhase;
export type VideoDubbingSnapshot = MediaDubbingSnapshot;

export interface VideoWorkbenchPayload {
  readonly contentUrl: string;
  readonly sourceRevision: string;
  readonly viewState: VideoWorkbenchViewState;
  readonly subtitleState: VideoSubtitleViewState;
  readonly subtitleSnapshot: VideoSubtitleSnapshot;
  readonly dubbingSnapshot: VideoDubbingSnapshot;
}

export interface VideoSaveViewStatePayload {
  readonly viewState: VideoWorkbenchViewState;
}

export interface VideoSaveViewStateResult {
  readonly saved: true;
  readonly savedTime: number;
}

export interface VideoSetSubtitleModePayload {
  readonly displayMode: VideoSubtitleDisplayMode;
}

export interface VideoTimeRangeAnchorV1 {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface VideoFrameRegionAnchorV1 {
  readonly timeSeconds: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export type VideoFrameRegionTarget = ContentAssetTarget & {
  readonly targetType: typeof VIDEO_FRAME_REGION_ANCHOR_TYPE;
  readonly targetVersion: typeof VIDEO_FRAME_REGION_ANCHOR_VERSION;
  readonly targetPayload: VideoFrameRegionAnchorV1;
};

export const DEFAULT_VIDEO_VIEW_STATE: Readonly<VideoWorkbenchViewState> =
  Object.freeze({
    currentTime: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
  });

export const DEFAULT_VIDEO_SUBTITLE_VIEW_STATE: Readonly<VideoSubtitleViewState> =
  Object.freeze({ displayMode: 'off' });

export const EMPTY_VIDEO_SUBTITLE_SNAPSHOT: Readonly<VideoSubtitleSnapshot> =
  EMPTY_MEDIA_SUBTITLE_SNAPSHOT;

export const EMPTY_VIDEO_DUBBING_SNAPSHOT: Readonly<VideoDubbingSnapshot> =
  EMPTY_MEDIA_DUBBING_SNAPSHOT;

export const videoCommands = {
  saveViewState: 'video:save-view-state',
  setSubtitleMode: 'video:set-subtitle-mode',
  getSubtitleSnapshot: 'video:get-subtitle-snapshot',
  retrySubtitles: 'video:retry-subtitles',
  startDubbing: 'video:start-dubbing',
  getDubbingSnapshot: 'video:get-dubbing-snapshot',
  retryDubbing: 'video:retry-dubbing',
} as const;

export const videoEventTypes = {
  subtitleSnapshot: 'video:subtitle-snapshot',
  subtitleCueFinal: 'video:subtitle-cue-final',
  dubbingSnapshot: 'video:dubbing-snapshot',
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

export function isVideoSubtitleDisplayMode(
  value: unknown,
): value is VideoSubtitleDisplayMode {
  return isMediaSubtitleDisplayMode(value);
}

export function isVideoSubtitleViewState(
  value: unknown,
): value is VideoSubtitleViewState {
  return isMediaSubtitleViewState(value);
}

export function isVideoWorkbenchStateV2(
  value: unknown,
): value is VideoWorkbenchStateV2 {
  return (
    isRecord(value) &&
    isVideoWorkbenchViewState(value.viewState) &&
    isVideoSubtitleViewState(value.subtitleState)
  );
}

export function isVideoSubtitleSnapshot(
  value: unknown,
): value is VideoSubtitleSnapshot {
  return isMediaSubtitleSnapshot(value);
}

export function cloneVideoSubtitleSnapshot(
  snapshot: VideoSubtitleSnapshot,
): JsonValue & VideoSubtitleSnapshot {
  return cloneMediaSubtitleSnapshot(snapshot);
}

export function cloneVideoSubtitleCueFinalPayload(
  payload: VideoSubtitleCueFinalPayload,
): JsonValue & VideoSubtitleCueFinalPayload {
  return cloneMediaSubtitleCueFinalPayload(payload);
}

export function isVideoDubbingSnapshot(
  value: unknown,
): value is VideoDubbingSnapshot {
  return isMediaDubbingSnapshot(value);
}

export function cloneVideoDubbingSnapshot(
  snapshot: VideoDubbingSnapshot,
): JsonValue & VideoDubbingSnapshot {
  return cloneMediaDubbingSnapshot(snapshot);
}

export function isVideoSubtitleCueFinalPayload(
  value: unknown,
): value is VideoSubtitleCueFinalPayload {
  return isMediaSubtitleCueFinalPayload(value);
}

export function isVideoWorkbenchPayload(
  value: unknown,
): value is JsonValue & VideoWorkbenchPayload {
  return (
    isRecord(value) &&
    typeof value.contentUrl === 'string' &&
    value.contentUrl.startsWith('learning-content://resource/') &&
    typeof value.sourceRevision === 'string' &&
    value.sourceRevision.trim().length > 0 &&
    value.sourceRevision.length <= 256 &&
    isVideoWorkbenchViewState(value.viewState) &&
    isVideoSubtitleViewState(value.subtitleState) &&
    isVideoSubtitleSnapshot(value.subtitleSnapshot) &&
    isVideoDubbingSnapshot(value.dubbingSnapshot)
  );
}

export function isVideoSetSubtitleModePayload(
  value: unknown,
): value is VideoSetSubtitleModePayload {
  return isRecord(value) && isVideoSubtitleDisplayMode(value.displayMode);
}

export function createVideoSetSubtitleModeCommand(
  displayMode: VideoSubtitleDisplayMode,
): WorkbenchCommand {
  return {
    type: videoCommands.setSubtitleMode,
    payload: { displayMode },
  };
}

export function createVideoRetrySubtitlesCommand(): WorkbenchCommand {
  return { type: videoCommands.retrySubtitles };
}

export function createVideoStartDubbingCommand(): WorkbenchCommand {
  return { type: videoCommands.startDubbing };
}

export function createVideoRetryDubbingCommand(): WorkbenchCommand {
  return { type: videoCommands.retryDubbing };
}

export function createVideoGetDubbingSnapshotCommand(): WorkbenchCommand {
  return { type: videoCommands.getDubbingSnapshot };
}

export function createVideoGetSubtitleSnapshotCommand(): WorkbenchCommand {
  return { type: videoCommands.getSubtitleSnapshot };
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

export function isVideoTimeRangeTarget(
  value: unknown,
): value is ContentAssetTarget & {
  readonly targetType: typeof VIDEO_TIME_RANGE_ANCHOR_TYPE;
  readonly targetVersion: typeof VIDEO_TIME_RANGE_ANCHOR_VERSION;
  readonly targetPayload: VideoTimeRangeAnchorV1;
} {
  return (
    isRecord(value) &&
    value.scope === 'content' &&
    value.targetType === VIDEO_TIME_RANGE_ANCHOR_TYPE &&
    value.targetVersion === VIDEO_TIME_RANGE_ANCHOR_VERSION &&
    isVideoTimeRangeAnchorV1(value.targetPayload)
  );
}

export function isVideoFrameRegionAnchorV1(
  value: unknown,
): value is VideoFrameRegionAnchorV1 {
  return (
    isRecord(value) &&
    isFiniteInRange(value.timeSeconds, 0, 1_000_000_000) &&
    isFiniteInRange(value.x, 0, 1) &&
    isFiniteInRange(value.y, 0, 1) &&
    isFiniteInRange(value.width, 0.000_001, 1) &&
    isFiniteInRange(value.height, 0.000_001, 1) &&
    Number(value.x) + Number(value.width) <= 1.000_001 &&
    Number(value.y) + Number(value.height) <= 1.000_001 &&
    Number.isSafeInteger(value.sourceWidth) &&
    Number(value.sourceWidth) > 0 &&
    Number(value.sourceWidth) <= MAX_VIDEO_FRAME_SOURCE_EDGE &&
    Number.isSafeInteger(value.sourceHeight) &&
    Number(value.sourceHeight) > 0 &&
    Number(value.sourceHeight) <= MAX_VIDEO_FRAME_SOURCE_EDGE &&
    Number(value.sourceWidth) * Number(value.sourceHeight) <=
      MAX_VIDEO_FRAME_SOURCE_PIXELS
  );
}

export function isVideoFrameRegionTarget(
  value: unknown,
): value is VideoFrameRegionTarget {
  return (
    isRecord(value) &&
    value.scope === 'content' &&
    value.targetType === VIDEO_FRAME_REGION_ANCHOR_TYPE &&
    value.targetVersion === VIDEO_FRAME_REGION_ANCHOR_VERSION &&
    isVideoFrameRegionAnchorV1(value.targetPayload)
  );
}

export function createVideoFrameRegionTarget(
  input: VideoFrameRegionAnchorV1,
): VideoFrameRegionTarget {
  if (!isVideoFrameRegionAnchorV1(input)) {
    throw new Error('视频画面区域无效');
  }
  return Object.freeze({
    scope: 'content' as const,
    targetType: VIDEO_FRAME_REGION_ANCHOR_TYPE,
    targetVersion: VIDEO_FRAME_REGION_ANCHOR_VERSION,
    targetPayload: Object.freeze({ ...input }),
  });
}

export function createVideoTimeRangeTarget(
  startSeconds: number,
  endSeconds = startSeconds,
): ContentAssetTarget {
  return {
    scope: 'content',
    targetType: VIDEO_TIME_RANGE_ANCHOR_TYPE,
    targetVersion: VIDEO_TIME_RANGE_ANCHOR_VERSION,
    targetPayload: {
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
