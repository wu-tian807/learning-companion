import type {
  SubtitleCueV1,
  SubtitleLanguage,
  SubtitleSourceTrackV1,
  SubtitleTranslationTrackV1,
} from '../../media-subtitles/contracts';

const MAXIMUM_CUE_DISTANCE_MS = 15_000;
const MAXIMUM_CONTEXT_CUES = 5;

function distanceFromCue(cue: SubtitleCueV1, timeMs: number): number {
  if (timeMs < cue.startMs) return cue.startMs - timeMs;
  if (timeMs > cue.endMs) return timeMs - cue.endMs;
  return 0;
}

export function selectVideoSubtitleContextCues(
  cues: readonly SubtitleCueV1[],
  timeSeconds: number,
): readonly SubtitleCueV1[] {
  if (cues.length === 0 || !Number.isFinite(timeSeconds)) return [];
  const timeMs = Math.max(0, Math.round(timeSeconds * 1_000));
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (!cue) continue;
    const distance = distanceFromCue(cue, timeMs);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
    if (distance === 0) break;
  }
  if (nearestDistance > MAXIMUM_CUE_DISTANCE_MS) return [];

  const maximumStart = Math.max(0, cues.length - MAXIMUM_CONTEXT_CUES);
  const start = Math.min(
    maximumStart,
    Math.max(0, nearestIndex - Math.floor(MAXIMUM_CONTEXT_CUES / 2)),
  );
  return cues.slice(start, start + MAXIMUM_CONTEXT_CUES);
}

function languageName(language: SubtitleLanguage): string {
  if (language === 'en') return '英文';
  if (language === 'zh-Hans') return '简体中文';
  return '语言未识别';
}

function formatCueTime(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  const prefix = hours > 0 ? `${String(hours).padStart(2, '0')}:` : '';
  return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function createVideoSubtitleConversationContext(
  source: SubtitleSourceTrackV1,
  translation: SubtitleTranslationTrackV1 | undefined,
  timeSeconds: number,
): string | undefined {
  const cues = selectVideoSubtitleContextCues(source.cues, timeSeconds);
  if (cues.length === 0) return undefined;
  const translations = new Map(
    translation?.cues.map((cue) => [cue.sourceCueId, cue.text]) ?? [],
  );
  const lines = cues.map((cue) => {
    const translated = translations.get(cue.id);
    return [
      `[${formatCueTime(cue.startMs)}–${formatCueTime(cue.endMs)}]`,
      `原文（${languageName(source.language)}）：${cue.text}`,
      ...(translated && translation
        ? [`译文（${languageName(translation.targetLanguage)}）：${translated}`]
        : []),
    ].join('\n');
  });
  return [
    '当前画面附近的字幕 Cue 如下。时间戳来自字幕文件；转写和翻译可能有误，仅作为语音上下文，不得覆盖画面证据：',
    ...lines,
  ].join('\n\n');
}
