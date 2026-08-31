import type { JsonValue } from '../../shared/workbench/protocol';
import { cloneJsonValue } from '../../shared/workbench/protocol';

export type MediaDubbingPhase =
  | 'idle'
  | 'runtime-required'
  | 'preparing-runtime'
  | 'separating'
  | 'cloning'
  | 'mixing'
  | 'interrupted'
  | 'ready'
  | 'unsupported'
  | 'failed';

export interface MediaDubbingSnapshot {
  readonly phase: MediaDubbingPhase;
  readonly completedPhrases: number;
  readonly totalPhrases: number;
  readonly completedDurationMs: number;
  readonly durationMs: number;
  readonly readySuffixStartMs: number;
  readonly audioUrl?: string;
  readonly previewAudioUrl?: string;
  readonly message?: string;
}

export const EMPTY_MEDIA_DUBBING_SNAPSHOT: Readonly<MediaDubbingSnapshot> =
  Object.freeze({
    phase: 'idle',
    completedPhrases: 0,
    totalPhrases: 0,
    completedDurationMs: 0,
    durationMs: 0,
    readySuffixStartMs: 0,
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMediaDubbingSnapshot(
  value: unknown,
): value is MediaDubbingSnapshot {
  return (
    isRecord(value) &&
    (value.phase === 'idle' ||
      value.phase === 'runtime-required' ||
      value.phase === 'preparing-runtime' ||
      value.phase === 'separating' ||
      value.phase === 'cloning' ||
      value.phase === 'mixing' ||
      value.phase === 'interrupted' ||
      value.phase === 'ready' ||
      value.phase === 'unsupported' ||
      value.phase === 'failed') &&
    Number.isSafeInteger(value.completedPhrases) &&
    Number(value.completedPhrases) >= 0 &&
    Number.isSafeInteger(value.totalPhrases) &&
    Number(value.totalPhrases) >= Number(value.completedPhrases) &&
    Number.isSafeInteger(value.completedDurationMs) &&
    Number(value.completedDurationMs) >= 0 &&
    Number.isSafeInteger(value.durationMs) &&
    Number(value.durationMs) >= Number(value.completedDurationMs) &&
    Number.isSafeInteger(value.readySuffixStartMs) &&
    Number(value.readySuffixStartMs) >= 0 &&
    Number(value.readySuffixStartMs) <= Number(value.durationMs) &&
    (value.audioUrl === undefined ||
      (typeof value.audioUrl === 'string' &&
        value.audioUrl.startsWith('learning-content://resource/'))) &&
    (value.previewAudioUrl === undefined ||
      (typeof value.previewAudioUrl === 'string' &&
        value.previewAudioUrl.startsWith('learning-content://resource/'))) &&
    (value.message === undefined || typeof value.message === 'string')
  );
}

export function cloneMediaDubbingSnapshot(
  snapshot: MediaDubbingSnapshot,
): JsonValue & MediaDubbingSnapshot {
  if (!isMediaDubbingSnapshot(snapshot)) {
    throw new Error('媒体配音状态无效');
  }
  return cloneJsonValue(snapshot as unknown as JsonValue) as JsonValue &
    MediaDubbingSnapshot;
}
