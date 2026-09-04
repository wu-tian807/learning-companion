import type { ContentAssetTarget } from '../../shared/workbench/asset-target';
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
import {
  cloneMediaDubbingSnapshot,
  EMPTY_MEDIA_DUBBING_SNAPSHOT,
  isMediaDubbingSnapshot,
  type MediaDubbingSnapshot,
} from '../media-dubbing/contracts';
import {
  cloneDubbingSpeakerTrack,
  isDubbingSpeakerTrack,
  type DubbingSpeakerTrackV1,
} from '../media-dubbing/dubbing-speaker-track';
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
  type MediaSubtitleSnapshot,
  type MediaSubtitleViewState,
} from '../media-subtitles/presentation';

export const AUDIO_WORKBENCH_ID = 'builtin.audio';
export const AUDIO_STATE_SCHEMA_VERSION = 2;
export const AUDIO_TIME_RANGE_ANCHOR_TYPE = 'audio.time-range';
export const AUDIO_TIME_RANGE_ANCHOR_VERSION = 1;
export const AUDIO_PLAYBACK_RATES = [
  0.5,
  0.75,
  1,
  1.25,
  1.5,
  2,
  3,
  4,
] as const;

export const audioWorkbenchManifest: AssetWorkbenchManifest<
  typeof AUDIO_WORKBENCH_ID
> = {
  id: AUDIO_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: [
    'audio/mpeg',
    'audio/wav',
    'audio/mp4',
    'audio/aac',
    'audio/flac',
    'audio/ogg',
    'audio/webm',
  ],
  requiredContentCapabilities: ['read-stream'],
  supportedTargetTypes: [AUDIO_TIME_RANGE_ANCHOR_TYPE],
  facilities: [
    rendererTransportFacilityDeclaration,
    overflowSurfaceFacilityDeclaration,
    createContextMenuSurfaceFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
  ],
};

export interface AudioWorkbenchViewState {
  readonly currentTime: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly playbackRate: number;
}

export interface AudioWorkbenchStateV1 {
  readonly viewState: AudioWorkbenchViewState;
}

export type AudioSubtitleDisplayMode = MediaSubtitleDisplayMode;
export type AudioSubtitleViewState = MediaSubtitleViewState;
export type AudioSubtitleSnapshot = MediaSubtitleSnapshot;
export type AudioSubtitleCueFinalPayload = MediaSubtitleCueFinalPayload;
export type AudioDubbingSnapshot = MediaDubbingSnapshot;
export type AudioSpeakerTrack = DubbingSpeakerTrackV1;

export interface AudioSpeakerTrackSnapshot {
  readonly track?: AudioSpeakerTrack;
}

export interface AudioWorkbenchStateV2 {
  readonly viewState: AudioWorkbenchViewState;
  readonly subtitleState: AudioSubtitleViewState;
}

export interface AudioWorkbenchPayload {
  readonly contentUrl: string;
  readonly sourceRevision: string;
  readonly viewState: AudioWorkbenchViewState;
  readonly subtitleState: AudioSubtitleViewState;
  readonly subtitleSnapshot: AudioSubtitleSnapshot;
  readonly dubbingSnapshot: AudioDubbingSnapshot;
  readonly speakerTrackSnapshot: AudioSpeakerTrackSnapshot;
}

export interface AudioSaveViewStatePayload {
  readonly viewState: AudioWorkbenchViewState;
}

export interface AudioSaveViewStateResult {
  readonly saved: true;
  readonly savedTime: number;
}

export interface AudioSetSubtitleModePayload {
  readonly displayMode: AudioSubtitleDisplayMode;
}

export interface AudioTimeRangeAnchorV1 {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export const DEFAULT_AUDIO_VIEW_STATE: Readonly<AudioWorkbenchViewState> =
  Object.freeze({
    currentTime: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
  });

export const DEFAULT_AUDIO_SUBTITLE_VIEW_STATE: Readonly<AudioSubtitleViewState> =
  Object.freeze({ displayMode: 'source' });

export const EMPTY_AUDIO_SUBTITLE_SNAPSHOT: Readonly<AudioSubtitleSnapshot> =
  EMPTY_MEDIA_SUBTITLE_SNAPSHOT;

export const EMPTY_AUDIO_DUBBING_SNAPSHOT: Readonly<AudioDubbingSnapshot> =
  EMPTY_MEDIA_DUBBING_SNAPSHOT;

export const EMPTY_AUDIO_SPEAKER_TRACK_SNAPSHOT: Readonly<AudioSpeakerTrackSnapshot> =
  Object.freeze({});

export const audioCommands = {
  saveViewState: 'audio:save-view-state',
  setSubtitleMode: 'audio:set-subtitle-mode',
  getSubtitleSnapshot: 'audio:get-subtitle-snapshot',
  retrySubtitles: 'audio:retry-subtitles',
  startDubbing: 'audio:start-dubbing',
  getDubbingSnapshot: 'audio:get-dubbing-snapshot',
  retryDubbing: 'audio:retry-dubbing',
  getSpeakerTrack: 'audio:get-speaker-track',
} as const;

export const audioEventTypes = {
  subtitleSnapshot: 'audio:subtitle-snapshot',
  subtitleCueFinal: 'audio:subtitle-cue-final',
  dubbingSnapshot: 'audio:dubbing-snapshot',
  speakerTrack: 'audio:speaker-track',
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

export function cloneAudioViewState(
  state: AudioWorkbenchViewState,
): JsonValue & AudioWorkbenchViewState {
  return {
    currentTime: state.currentTime,
    volume: state.volume,
    muted: state.muted,
    playbackRate: state.playbackRate,
  };
}

export function isAudioWorkbenchViewState(
  value: unknown,
): value is AudioWorkbenchViewState {
  return (
    isRecord(value) &&
    isFiniteInRange(value.currentTime, 0, 1_000_000_000) &&
    isFiniteInRange(value.volume, 0, 1) &&
    typeof value.muted === 'boolean' &&
    isFiniteInRange(value.playbackRate, 0.25, 4)
  );
}

export function isAudioWorkbenchStateV1(
  value: unknown,
): value is AudioWorkbenchStateV1 {
  return isRecord(value) && isAudioWorkbenchViewState(value.viewState);
}

export function isAudioWorkbenchStateV2(
  value: unknown,
): value is AudioWorkbenchStateV2 {
  return (
    isRecord(value) &&
    isAudioWorkbenchViewState(value.viewState) &&
    isMediaSubtitleViewState(value.subtitleState)
  );
}

export function isAudioSubtitleSnapshot(
  value: unknown,
): value is AudioSubtitleSnapshot {
  return isMediaSubtitleSnapshot(value);
}

export function cloneAudioSubtitleSnapshot(
  snapshot: AudioSubtitleSnapshot,
): JsonValue & AudioSubtitleSnapshot {
  return cloneMediaSubtitleSnapshot(snapshot);
}

export function isAudioSubtitleCueFinalPayload(
  value: unknown,
): value is AudioSubtitleCueFinalPayload {
  return isMediaSubtitleCueFinalPayload(value);
}

export function cloneAudioSubtitleCueFinalPayload(
  payload: AudioSubtitleCueFinalPayload,
): JsonValue & AudioSubtitleCueFinalPayload {
  return cloneMediaSubtitleCueFinalPayload(payload);
}

export function isAudioDubbingSnapshot(
  value: unknown,
): value is AudioDubbingSnapshot {
  return isMediaDubbingSnapshot(value);
}

export function cloneAudioDubbingSnapshot(
  snapshot: AudioDubbingSnapshot,
): JsonValue & AudioDubbingSnapshot {
  return cloneMediaDubbingSnapshot(snapshot);
}

export function isAudioSpeakerTrackSnapshot(
  value: unknown,
): value is AudioSpeakerTrackSnapshot {
  return (
    isRecord(value) &&
    (value.track === undefined || isDubbingSpeakerTrack(value.track))
  );
}

export function cloneAudioSpeakerTrackSnapshot(
  snapshot: AudioSpeakerTrackSnapshot,
): JsonValue & AudioSpeakerTrackSnapshot {
  if (!isAudioSpeakerTrackSnapshot(snapshot)) {
    throw new Error('Audio Workbench 说话人轨道状态无效');
  }
  return (snapshot.track
    ? { track: cloneDubbingSpeakerTrack(snapshot.track) }
    : {}) as JsonValue & AudioSpeakerTrackSnapshot;
}

export function isAudioWorkbenchPayload(
  value: unknown,
): value is JsonValue & AudioWorkbenchPayload {
  return (
    isRecord(value) &&
    typeof value.contentUrl === 'string' &&
    value.contentUrl.startsWith('learning-content://resource/') &&
    typeof value.sourceRevision === 'string' &&
    value.sourceRevision.trim().length > 0 &&
    value.sourceRevision.length <= 256 &&
    isAudioWorkbenchViewState(value.viewState) &&
    isMediaSubtitleViewState(value.subtitleState) &&
    isAudioSubtitleSnapshot(value.subtitleSnapshot) &&
    isAudioDubbingSnapshot(value.dubbingSnapshot) &&
    isAudioSpeakerTrackSnapshot(value.speakerTrackSnapshot)
  );
}

export function isAudioSetSubtitleModePayload(
  value: unknown,
): value is AudioSetSubtitleModePayload {
  return isRecord(value) && isMediaSubtitleDisplayMode(value.displayMode);
}

export function isAudioSaveViewStatePayload(
  value: unknown,
): value is JsonValue & AudioSaveViewStatePayload {
  return isRecord(value) && isAudioWorkbenchViewState(value.viewState);
}

export function isAudioSaveViewStateResult(
  value: unknown,
): value is JsonValue & AudioSaveViewStateResult {
  return (
    isRecord(value) &&
    value.saved === true &&
    typeof value.savedTime === 'number' &&
    Number.isSafeInteger(value.savedTime) &&
    value.savedTime >= 0
  );
}

export function isAudioTimeRangeAnchorV1(
  value: unknown,
): value is AudioTimeRangeAnchorV1 {
  return (
    isRecord(value) &&
    isFiniteInRange(value.startSeconds, 0, 1_000_000_000) &&
    isFiniteInRange(value.endSeconds, 0, 1_000_000_000) &&
    value.endSeconds >= value.startSeconds
  );
}

export function isAudioTimeRangeTarget(
  value: unknown,
): value is ContentAssetTarget & {
  readonly targetType: typeof AUDIO_TIME_RANGE_ANCHOR_TYPE;
  readonly targetVersion: typeof AUDIO_TIME_RANGE_ANCHOR_VERSION;
  readonly targetPayload: JsonValue & AudioTimeRangeAnchorV1;
} {
  return (
    isRecord(value) &&
    value.scope === 'content' &&
    value.targetType === AUDIO_TIME_RANGE_ANCHOR_TYPE &&
    value.targetVersion === AUDIO_TIME_RANGE_ANCHOR_VERSION &&
    isAudioTimeRangeAnchorV1(value.targetPayload)
  );
}

export function createAudioTimeRangeTarget(
  startSeconds: number,
  endSeconds = startSeconds,
): ContentAssetTarget {
  return {
    scope: 'content',
    targetType: AUDIO_TIME_RANGE_ANCHOR_TYPE,
    targetVersion: AUDIO_TIME_RANGE_ANCHOR_VERSION,
    targetPayload: {
      startSeconds,
      endSeconds,
    },
  };
}

export function createAudioSaveViewStateCommand(
  viewState: AudioWorkbenchViewState,
): WorkbenchCommand {
  return {
    type: audioCommands.saveViewState,
    payload: {
      viewState: cloneAudioViewState(viewState),
    },
  };
}

export function createAudioSetSubtitleModeCommand(
  displayMode: AudioSubtitleDisplayMode,
): WorkbenchCommand {
  return {
    type: audioCommands.setSubtitleMode,
    payload: { displayMode },
  };
}

export function createAudioGetSubtitleSnapshotCommand(): WorkbenchCommand {
  return { type: audioCommands.getSubtitleSnapshot };
}

export function createAudioRetrySubtitlesCommand(): WorkbenchCommand {
  return { type: audioCommands.retrySubtitles };
}

export function createAudioStartDubbingCommand(): WorkbenchCommand {
  return { type: audioCommands.startDubbing };
}

export function createAudioGetDubbingSnapshotCommand(): WorkbenchCommand {
  return { type: audioCommands.getDubbingSnapshot };
}

export function createAudioRetryDubbingCommand(): WorkbenchCommand {
  return { type: audioCommands.retryDubbing };
}

export function createAudioGetSpeakerTrackCommand(): WorkbenchCommand {
  return { type: audioCommands.getSpeakerTrack };
}
