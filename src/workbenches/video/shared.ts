import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
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
import { cloneJsonValue } from '../../shared/workbench/protocol';
import {
  isSubtitleSourceTrackV1,
  isSubtitleTranslationCueV1,
  isSubtitleTranslationTrackV1,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationCueV1,
  type SubtitleTranslationTrackV1,
} from '../media-subtitles/contracts';

export const VIDEO_WORKBENCH_ID = 'builtin.video';
export const VIDEO_STATE_SCHEMA_VERSION = 2;
export const VIDEO_TIME_RANGE_ANCHOR_TYPE = 'video.time-range';
export const VIDEO_TIME_RANGE_ANCHOR_VERSION = 1;
export const VIDEO_FRAME_REGION_ANCHOR_TYPE = 'video.frame-region';
export const VIDEO_FRAME_REGION_ANCHOR_VERSION = 1;

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
  supportedAnchorTypes: [
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

export type VideoSubtitleDisplayMode =
  'off' | 'source' | 'translated' | 'bilingual';

export interface VideoSubtitleViewState {
  readonly displayMode: VideoSubtitleDisplayMode;
}

export interface VideoWorkbenchStateV2 {
  readonly viewState: VideoWorkbenchViewState;
  readonly subtitleState: VideoSubtitleViewState;
}

export type VideoSubtitlePhase =
  | 'idle'
  | 'queued'
  | 'runtime-required'
  | 'transcribing'
  | 'source-ready'
  | 'translating'
  | 'ready'
  | 'unsupported-language'
  | 'failed';

export interface VideoSubtitleSnapshot {
  readonly phase: VideoSubtitlePhase;
  readonly source?: SubtitleSourceTrackV1;
  readonly translation?: SubtitleTranslationTrackV1;
  readonly partialTranslations: readonly SubtitleTranslationCueV1[];
  readonly completedCues: number;
  readonly totalCues: number;
  readonly message?: string;
}

export interface VideoSubtitleCueFinalPayload {
  readonly sourceTrackRevision: string;
  readonly cue: SubtitleTranslationCueV1;
  readonly completedCues: number;
  readonly totalCues: number;
}

export interface VideoWorkbenchPayload {
  readonly contentUrl: string;
  readonly sourceRevision: string;
  readonly viewState: VideoWorkbenchViewState;
  readonly subtitleState: VideoSubtitleViewState;
  readonly subtitleSnapshot: VideoSubtitleSnapshot;
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

export type VideoFrameRegionTarget = ContentAnchorTarget & {
  readonly anchorType: typeof VIDEO_FRAME_REGION_ANCHOR_TYPE;
  readonly anchorVersion: typeof VIDEO_FRAME_REGION_ANCHOR_VERSION;
  readonly anchorPayload: VideoFrameRegionAnchorV1;
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
  Object.freeze({
    phase: 'idle',
    partialTranslations: Object.freeze([]),
    completedCues: 0,
    totalCues: 0,
  });

export const videoCommands = {
  saveViewState: 'video:save-view-state',
  setSubtitleMode: 'video:set-subtitle-mode',
  retrySubtitles: 'video:retry-subtitles',
} as const;

export const videoEventTypes = {
  subtitleSnapshot: 'video:subtitle-snapshot',
  subtitleCueFinal: 'video:subtitle-cue-final',
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
  return (
    value === 'off' ||
    value === 'source' ||
    value === 'translated' ||
    value === 'bilingual'
  );
}

export function isVideoSubtitleViewState(
  value: unknown,
): value is VideoSubtitleViewState {
  return isRecord(value) && isVideoSubtitleDisplayMode(value.displayMode);
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

function isVideoSubtitlePhase(value: unknown): value is VideoSubtitlePhase {
  return (
    value === 'idle' ||
    value === 'queued' ||
    value === 'runtime-required' ||
    value === 'transcribing' ||
    value === 'source-ready' ||
    value === 'translating' ||
    value === 'ready' ||
    value === 'unsupported-language' ||
    value === 'failed'
  );
}

export function isVideoSubtitleSnapshot(
  value: unknown,
): value is VideoSubtitleSnapshot {
  return (
    isRecord(value) &&
    isVideoSubtitlePhase(value.phase) &&
    (value.source === undefined || isSubtitleSourceTrackV1(value.source)) &&
    (value.translation === undefined ||
      isSubtitleTranslationTrackV1(value.translation)) &&
    Array.isArray(value.partialTranslations) &&
    value.partialTranslations.every(isSubtitleTranslationCueV1) &&
    Number.isSafeInteger(value.completedCues) &&
    Number(value.completedCues) >= 0 &&
    Number.isSafeInteger(value.totalCues) &&
    Number(value.totalCues) >= Number(value.completedCues) &&
    (value.message === undefined || typeof value.message === 'string')
  );
}

export function cloneVideoSubtitleSnapshot(
  snapshot: VideoSubtitleSnapshot,
): JsonValue & VideoSubtitleSnapshot {
  if (!isVideoSubtitleSnapshot(snapshot)) {
    throw new Error('Video 字幕状态无效');
  }
  const normalized = {
    phase: snapshot.phase,
    ...(snapshot.source === undefined ? {} : { source: snapshot.source }),
    ...(snapshot.translation === undefined
      ? {}
      : { translation: snapshot.translation }),
    partialTranslations: snapshot.partialTranslations,
    completedCues: snapshot.completedCues,
    totalCues: snapshot.totalCues,
    ...(snapshot.message === undefined ? {} : { message: snapshot.message }),
  };
  return cloneJsonValue(normalized as unknown as JsonValue) as JsonValue &
    VideoSubtitleSnapshot;
}

export function cloneVideoSubtitleCueFinalPayload(
  payload: VideoSubtitleCueFinalPayload,
): JsonValue & VideoSubtitleCueFinalPayload {
  if (!isVideoSubtitleCueFinalPayload(payload)) {
    throw new Error('Video 字幕 Cue 事件无效');
  }
  return cloneJsonValue(payload as unknown as JsonValue) as JsonValue &
    VideoSubtitleCueFinalPayload;
}

export function isVideoSubtitleCueFinalPayload(
  value: unknown,
): value is VideoSubtitleCueFinalPayload {
  return (
    isRecord(value) &&
    typeof value.sourceTrackRevision === 'string' &&
    value.sourceTrackRevision.trim().length > 0 &&
    isSubtitleTranslationCueV1(value.cue) &&
    Number.isSafeInteger(value.completedCues) &&
    Number(value.completedCues) > 0 &&
    Number.isSafeInteger(value.totalCues) &&
    Number(value.totalCues) >= Number(value.completedCues)
  );
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
    isVideoSubtitleSnapshot(value.subtitleSnapshot)
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
    Number.isSafeInteger(value.sourceHeight) &&
    Number(value.sourceHeight) > 0
  );
}

export function isVideoFrameRegionTarget(
  value: unknown,
): value is VideoFrameRegionTarget {
  return (
    isRecord(value) &&
    value.scope === 'content' &&
    value.anchorType === VIDEO_FRAME_REGION_ANCHOR_TYPE &&
    value.anchorVersion === VIDEO_FRAME_REGION_ANCHOR_VERSION &&
    isVideoFrameRegionAnchorV1(value.anchorPayload)
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
    anchorType: VIDEO_FRAME_REGION_ANCHOR_TYPE,
    anchorVersion: VIDEO_FRAME_REGION_ANCHOR_VERSION,
    anchorPayload: Object.freeze({ ...input }),
  });
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
