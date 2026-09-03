import type { JsonValue } from '../../shared/workbench/protocol';
import { cloneJsonValue } from '../../shared/workbench/protocol';
import {
  isSubtitleSourceTrackV1,
  isSubtitleTranslationCueV1,
  isSubtitleTranslationTrackV1,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationCueV1,
  type SubtitleTranslationTrackV1,
} from './contracts';

export type MediaSubtitleDisplayMode =
  | 'off'
  | 'source'
  | 'translated'
  | 'bilingual';

export interface MediaSubtitleViewState {
  readonly displayMode: MediaSubtitleDisplayMode;
}

export type MediaSubtitlePhase =
  | 'idle'
  | 'queued'
  | 'runtime-required'
  | 'transcribing'
  | 'source-ready'
  | 'translating'
  | 'provider-required'
  | 'ready'
  | 'unsupported-language'
  | 'failed';

export interface MediaSubtitleSnapshot {
  readonly phase: MediaSubtitlePhase;
  readonly source?: SubtitleSourceTrackV1;
  /** Revision of the committed source-subtitle Artifact, not the media file. */
  readonly sourceTrackRevision?: string;
  readonly translation?: SubtitleTranslationTrackV1;
  readonly partialTranslations: readonly SubtitleTranslationCueV1[];
  readonly completedCues: number;
  readonly totalCues: number;
  readonly message?: string;
}

export interface MediaSubtitleCueFinalPayload {
  readonly sourceTrackRevision: string;
  readonly cue: SubtitleTranslationCueV1;
  readonly completedCues: number;
  readonly totalCues: number;
}

export const EMPTY_MEDIA_SUBTITLE_SNAPSHOT: Readonly<MediaSubtitleSnapshot> =
  Object.freeze({
    phase: 'idle',
    partialTranslations: Object.freeze([]),
    completedCues: 0,
    totalCues: 0,
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMediaSubtitleDisplayMode(
  value: unknown,
): value is MediaSubtitleDisplayMode {
  return (
    value === 'off' ||
    value === 'source' ||
    value === 'translated' ||
    value === 'bilingual'
  );
}

export function isMediaSubtitleViewState(
  value: unknown,
): value is MediaSubtitleViewState {
  return isRecord(value) && isMediaSubtitleDisplayMode(value.displayMode);
}

export function isMediaSubtitleSnapshot(
  value: unknown,
): value is MediaSubtitleSnapshot {
  return (
    isRecord(value) &&
    (value.phase === 'idle' ||
      value.phase === 'queued' ||
      value.phase === 'runtime-required' ||
      value.phase === 'transcribing' ||
      value.phase === 'source-ready' ||
      value.phase === 'translating' ||
      value.phase === 'provider-required' ||
      value.phase === 'ready' ||
      value.phase === 'unsupported-language' ||
      value.phase === 'failed') &&
    (value.source === undefined || isSubtitleSourceTrackV1(value.source)) &&
    (value.sourceTrackRevision === undefined ||
      (typeof value.sourceTrackRevision === 'string' &&
        value.sourceTrackRevision.trim().length > 0)) &&
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

export function cloneMediaSubtitleSnapshot(
  snapshot: MediaSubtitleSnapshot,
): JsonValue & MediaSubtitleSnapshot {
  if (!isMediaSubtitleSnapshot(snapshot)) {
    throw new Error('媒体字幕状态无效');
  }
  const normalized = {
    phase: snapshot.phase,
    ...(snapshot.source === undefined ? {} : { source: snapshot.source }),
    ...(snapshot.sourceTrackRevision === undefined
      ? {}
      : { sourceTrackRevision: snapshot.sourceTrackRevision }),
    ...(snapshot.translation === undefined
      ? {}
      : { translation: snapshot.translation }),
    partialTranslations: snapshot.partialTranslations,
    completedCues: snapshot.completedCues,
    totalCues: snapshot.totalCues,
    ...(snapshot.message === undefined ? {} : { message: snapshot.message }),
  };
  return cloneJsonValue(normalized as unknown as JsonValue) as JsonValue &
    MediaSubtitleSnapshot;
}

export function isMediaSubtitleCueFinalPayload(
  value: unknown,
): value is MediaSubtitleCueFinalPayload {
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

export function cloneMediaSubtitleCueFinalPayload(
  payload: MediaSubtitleCueFinalPayload,
): JsonValue & MediaSubtitleCueFinalPayload {
  if (!isMediaSubtitleCueFinalPayload(payload)) {
    throw new Error('媒体字幕 Cue 事件无效');
  }
  return cloneJsonValue(payload as unknown as JsonValue) as JsonValue &
    MediaSubtitleCueFinalPayload;
}

export function applyMediaSubtitleCueFinal(
  snapshot: MediaSubtitleSnapshot,
  payload: MediaSubtitleCueFinalPayload,
): MediaSubtitleSnapshot {
  if (snapshot.sourceTrackRevision !== payload.sourceTrackRevision) {
    return snapshot;
  }
  const translations = new Map(
    snapshot.partialTranslations.map((cue) => [cue.sourceCueId, cue]),
  );
  translations.set(payload.cue.sourceCueId, payload.cue);
  const ordered =
    snapshot.source?.cues.flatMap((cue) => {
      const translated = translations.get(cue.id);
      return translated ? [translated] : [];
    }) ?? [...translations.values()];
  return Object.freeze({
    ...snapshot,
    phase: 'translating' as const,
    partialTranslations: Object.freeze(ordered),
    completedCues: payload.completedCues,
    totalCues: payload.totalCues,
  });
}
