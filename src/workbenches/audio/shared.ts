import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import type {
  JsonValue,
  WorkbenchCommand,
} from '../../shared/workbench/protocol';

export const AUDIO_WORKBENCH_ID = 'builtin.audio';
export const AUDIO_STATE_SCHEMA_VERSION = 1;
export const AUDIO_TIME_RANGE_ANCHOR_TYPE = 'audio.time-range';
export const AUDIO_TIME_RANGE_ANCHOR_VERSION = 1;
export const AUDIO_PLAYBACK_RATES = [
  0.5,
  0.75,
  1,
  1.25,
  1.5,
  2,
] as const;

export const audioWorkbenchManifest: AssetWorkbenchManifest = {
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
  supportedAnchorTypes: [AUDIO_TIME_RANGE_ANCHOR_TYPE],
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

export interface AudioWorkbenchPayload {
  readonly contentUrl: string;
  readonly viewState: AudioWorkbenchViewState;
}

export interface AudioSaveViewStatePayload {
  readonly viewState: AudioWorkbenchViewState;
}

export interface AudioSaveViewStateResult {
  readonly saved: true;
  readonly savedTime: number;
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

export const audioCommands = {
  saveViewState: 'audio:save-view-state',
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

export function isAudioWorkbenchPayload(
  value: unknown,
): value is JsonValue & AudioWorkbenchPayload {
  return (
    isRecord(value) &&
    typeof value.contentUrl === 'string' &&
    value.contentUrl.startsWith('learning-content://resource/') &&
    isAudioWorkbenchViewState(value.viewState)
  );
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

export function createAudioTimeRangeTarget(
  startSeconds: number,
  endSeconds = startSeconds,
): ContentAnchorTarget {
  return {
    scope: 'content',
    anchorType: AUDIO_TIME_RANGE_ANCHOR_TYPE,
    anchorVersion: AUDIO_TIME_RANGE_ANCHOR_VERSION,
    anchorPayload: {
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
