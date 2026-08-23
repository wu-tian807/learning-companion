export const SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE =
  'application/vnd.learning-companion.subtitle-track+json';
export const SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE =
  'application/vnd.learning-companion.subtitle-translation+json';

export type SubtitleLanguage = 'en' | 'zh-Hans' | 'unknown';
export type TranslatableSubtitleLanguage = Exclude<
  SubtitleLanguage,
  'unknown'
>;
export type SubtitleTranslationProfile = 'fast' | 'quality';

export interface SubtitleCueV1 {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly sourceCueIds: readonly string[];
}

export interface SubtitleEngineV1 {
  readonly id: string;
  readonly version: string;
  readonly model: string;
  readonly backend: string;
}

export interface SubtitleSourceTrackV1 {
  readonly version: 1;
  readonly kind: 'subtitle-source';
  readonly sourceRevision: string;
  readonly language: SubtitleLanguage;
  readonly origin: 'asr';
  readonly engine: SubtitleEngineV1;
  readonly generatedTime: number;
  readonly cues: readonly SubtitleCueV1[];
}

export interface SubtitleTranslationCueV1 {
  readonly sourceCueId: string;
  readonly text: string;
}

export interface SubtitleTranslationTrackV1 {
  readonly version: 1;
  readonly kind: 'subtitle-translation';
  readonly sourceTrackRevision: string;
  readonly sourceLanguage: TranslatableSubtitleLanguage;
  readonly targetLanguage: TranslatableSubtitleLanguage;
  readonly profile: SubtitleTranslationProfile;
  readonly engine: SubtitleEngineV1;
  readonly generatedTime: number;
  readonly cues: readonly SubtitleTranslationCueV1[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maximum = 65_536): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isSubtitleLanguage(value: unknown): value is SubtitleLanguage {
  return value === 'en' || value === 'zh-Hans' || value === 'unknown';
}

export function isTranslatableSubtitleLanguage(
  value: unknown,
): value is TranslatableSubtitleLanguage {
  return value === 'en' || value === 'zh-Hans';
}

function isSubtitleEngineV1(value: unknown): value is SubtitleEngineV1 {
  return (
    isRecord(value) &&
    isText(value.id, 256) &&
    isText(value.version, 256) &&
    isText(value.model, 256) &&
    isText(value.backend, 256)
  );
}

export function isSubtitleCueV1(value: unknown): value is SubtitleCueV1 {
  return (
    isRecord(value) &&
    isText(value.id, 256) &&
    isTime(value.startMs) &&
    isTime(value.endMs) &&
    value.endMs > value.startMs &&
    isText(value.text) &&
    Array.isArray(value.sourceCueIds) &&
    value.sourceCueIds.length > 0 &&
    value.sourceCueIds.every((id) => isText(id, 256)) &&
    new Set(value.sourceCueIds).size === value.sourceCueIds.length
  );
}

function hasValidCueOrder(cues: readonly SubtitleCueV1[]): boolean {
  const ids = new Set<string>();
  const sourceCueIds = new Set<string>();
  let previousEnd = -1;

  for (const cue of cues) {
    if (ids.has(cue.id) || cue.startMs < previousEnd) {
      return false;
    }
    ids.add(cue.id);
    for (const sourceCueId of cue.sourceCueIds) {
      if (sourceCueIds.has(sourceCueId)) return false;
      sourceCueIds.add(sourceCueId);
    }
    previousEnd = cue.endMs;
  }
  return true;
}

export function isSubtitleSourceTrackV1(
  value: unknown,
): value is SubtitleSourceTrackV1 {
  return (
    isRecord(value) &&
    value.version === 1 &&
    value.kind === 'subtitle-source' &&
    isText(value.sourceRevision, 256) &&
    isSubtitleLanguage(value.language) &&
    value.origin === 'asr' &&
    isSubtitleEngineV1(value.engine) &&
    isTime(value.generatedTime) &&
    Array.isArray(value.cues) &&
    value.cues.length > 0 &&
    value.cues.every(isSubtitleCueV1) &&
    hasValidCueOrder(value.cues)
  );
}

export function isSubtitleTranslationCueV1(
  value: unknown,
): value is SubtitleTranslationCueV1 {
  return (
    isRecord(value) &&
    isText(value.sourceCueId, 256) &&
    isText(value.text)
  );
}

export function isSubtitleTranslationTrackV1(
  value: unknown,
): value is SubtitleTranslationTrackV1 {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.kind !== 'subtitle-translation' ||
    !isText(value.sourceTrackRevision, 256) ||
    !isTranslatableSubtitleLanguage(value.sourceLanguage) ||
    !isTranslatableSubtitleLanguage(value.targetLanguage) ||
    value.sourceLanguage === value.targetLanguage ||
    (value.profile !== 'fast' && value.profile !== 'quality') ||
    !isSubtitleEngineV1(value.engine) ||
    !isTime(value.generatedTime) ||
    !Array.isArray(value.cues) ||
    value.cues.length === 0 ||
    !value.cues.every(isSubtitleTranslationCueV1)
  ) {
    return false;
  }

  return (
    new Set(value.cues.map((cue) => cue.sourceCueId)).size ===
    value.cues.length
  );
}

export function oppositeSubtitleLanguage(
  language: TranslatableSubtitleLanguage,
): TranslatableSubtitleLanguage {
  return language === 'en' ? 'zh-Hans' : 'en';
}
