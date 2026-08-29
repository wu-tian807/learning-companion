import type {
  SubtitleCueV1,
  SubtitleTranslationTrackV1,
} from '../media-subtitles/contracts';

const MAXIMUM_MERGE_GAP_MS = 700;
const MAXIMUM_PHRASE_DURATION_MS = 8_000;
const CHINESE_SHORT_CHARACTER_COUNT = 4;
const ENGLISH_SHORT_WORD_COUNT = 2;
const CHINESE_MAXIMUM_CHARACTER_COUNT = 34;
const ENGLISH_MAXIMUM_WORD_COUNT = 18;

export const DUBBING_PHRASE_PLANNER_VERSION = 3;

export interface DubbingCueSpeakerAssignment {
  readonly cueId: string;
  readonly speakerId: string;
  readonly referenceEligible: boolean;
  readonly dominantOverlapMs: number;
  readonly otherSpeakerOverlapMs: number;
}
export interface DubbingPhrase {
  readonly id: string;
  readonly speakerId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly spokenText: string;
  readonly sourceText: string;
  readonly sourceCueIds: readonly string[];
}

const ENGLISH_CONTINUATION_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'by',
  'and',
  'or',
  'but',
]);
const CHINESE_DIGITS = Object.freeze([
  '零',
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
]);
const CHINESE_UNITS = Object.freeze([
  '',
  '十',
  '百',
  '千',
  '万',
  '十万',
  '百万',
  '千万',
  '亿',
  '十亿',
  '百亿',
  '千亿',
  '兆',
]);

function cleanText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function digitsIndividually(value: string): string {
  return [...value].map((digit) => CHINESE_DIGITS[Number(digit)]).join('');
}

function integerToChinese(value: string): string {
  const digits = value.replaceAll(',', '');
  if (!/^\d+$/u.test(digits)) return value;
  if (digits === '0') return CHINESE_DIGITS[0]!;
  if (digits.length > CHINESE_UNITS.length || /^0\d/u.test(digits)) {
    return digitsIndividually(digits);
  }

  let result = '';
  let pendingZero = false;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    const unitIndex = digits.length - index - 1;
    if (digit === 0) {
      if (result && [...digits.slice(index + 1)].some((next) => next !== '0')) {
        pendingZero = true;
      }
      continue;
    }
    if (pendingZero) {
      result += CHINESE_DIGITS[0];
      pendingZero = false;
    }
    result += `${CHINESE_DIGITS[digit]}${CHINESE_UNITS[unitIndex]}`;
  }
  return result.replace(/^一十/u, '十');
}

function decimalToChinese(value: string): string {
  const [integer = '', fraction] = value.replaceAll(',', '').split('.');
  return fraction === undefined
    ? integerToChinese(integer)
    : `${integerToChinese(integer)}点${digitsIndividually(fraction)}`;
}

export function normalizeChineseSpokenText(value: string): string {
  return cleanText(value).replace(
    /(\d{1,2}):(\d{2})|(\d[\d,]*(?:\.\d+)?)%|(\d{4})(?=年)|\d[\d,]*(?:\.\d+)?/gu,
    (
      match,
      hour: string | undefined,
      minute: string | undefined,
      percent: string | undefined,
      year: string | undefined,
    ) => {
      if (hour !== undefined && minute !== undefined) {
        const spokenMinute = minute.startsWith('0')
          ? digitsIndividually(minute)
          : integerToChinese(minute);
        return `${integerToChinese(String(Number(hour)))}点${spokenMinute}分`;
      }
      if (percent !== undefined) return `百分之${decimalToChinese(percent)}`;
      if (year !== undefined) return digitsIndividually(year);
      return decimalToChinese(match);
    },
  );
}

function meaningfulChineseCharacters(text: string): number {
  return [...text].filter((character) => /[\p{L}\p{N}]/u.test(character))
    .length;
}

function englishWords(text: string): readonly string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

function isShort(text: string, language: 'zh-Hans' | 'en'): boolean {
  return language === 'zh-Hans'
    ? meaningfulChineseCharacters(text) <= CHINESE_SHORT_CHARACTER_COUNT
    : englishWords(text).length <= ENGLISH_SHORT_WORD_COUNT;
}

function needsContinuation(text: string, language: 'zh-Hans' | 'en'): boolean {
  if (language === 'zh-Hans') {
    return /[的地得把被将向在为从到与和或及并而但由让给跟对以于]$/u.test(text);
  }
  return ENGLISH_CONTINUATION_WORDS.has(
    englishWords(text).at(-1)?.toLowerCase() ?? '',
  );
}

function withinTextLimit(text: string, language: 'zh-Hans' | 'en'): boolean {
  return language === 'zh-Hans'
    ? meaningfulChineseCharacters(text) <= CHINESE_MAXIMUM_CHARACTER_COUNT
    : englishWords(text).length <= ENGLISH_MAXIMUM_WORD_COUNT;
}

function joinText(
  left: string,
  right: string,
  language: 'zh-Hans' | 'en',
): string {
  if (language === 'en') return `${left} ${right}`.replace(/\s+/gu, ' ');
  if (needsContinuation(left, language) || /[。！？，；：…]$/u.test(left)) {
    return `${left}${right}`;
  }
  return `${left}，${right}`;
}

function joinSourceText(left: string, right: string): string {
  return /\p{Script=Han}/u.test(left) || /\p{Script=Han}/u.test(right)
    ? `${left}${right}`
    : `${left} ${right}`.replace(/\s+/gu, ' ');
}

type MutablePhrase = Omit<DubbingPhrase, 'spokenText'>;

function canMerge(
  left: MutablePhrase,
  right: MutablePhrase,
  language: 'zh-Hans' | 'en',
): boolean {
  const gap = right.startMs - left.endMs;
  return (
    left.speakerId === right.speakerId &&
    gap >= 0 &&
    gap <= MAXIMUM_MERGE_GAP_MS &&
    right.endMs - left.startMs <= MAXIMUM_PHRASE_DURATION_MS &&
    withinTextLimit(joinText(left.text, right.text, language), language)
  );
}

function merge(
  left: MutablePhrase,
  right: MutablePhrase,
  language: 'zh-Hans' | 'en',
): MutablePhrase {
  return {
    id: left.id,
    speakerId: left.speakerId,
    startMs: left.startMs,
    endMs: right.endMs,
    text: joinText(left.text, right.text, language),
    sourceText: joinSourceText(left.sourceText, right.sourceText),
    sourceCueIds: [...left.sourceCueIds, ...right.sourceCueIds],
  };
}

export function createDubbingPhrases(
  sourceCues: readonly SubtitleCueV1[],
  translation: SubtitleTranslationTrackV1,
  speakerAssignments: readonly DubbingCueSpeakerAssignment[],
): readonly DubbingPhrase[] {
  const translations = new Map(
    translation.cues.map((cue) => [cue.sourceCueId, cleanText(cue.text)]),
  );
  const speakers = new Map(
    speakerAssignments.map((assignment) => [
      assignment.cueId,
      assignment.speakerId,
    ]),
  );
  if (speakers.size !== speakerAssignments.length) {
    throw new Error('说话人归属包含重复字幕');
  }
  const input: MutablePhrase[] = sourceCues.map((cue, index) => {
    const text = translations.get(cue.id);
    if (!text) throw new Error(`字幕 ${cue.id} 缺少译文`);
    const speakerId = speakers.get(cue.id);
    if (!speakerId) throw new Error(`字幕 ${cue.id} 缺少说话人归属`);
    return {
      id: `phrase-${String(index + 1).padStart(6, '0')}`,
      speakerId,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text,
      sourceText: cleanText(cue.text),
      sourceCueIds: [cue.id],
    };
  });
  const phrases: MutablePhrase[] = [];

  for (const cue of input) {
    const previous = phrases.at(-1);
    if (
      isShort(cue.text, translation.targetLanguage) &&
      !needsContinuation(cue.text, translation.targetLanguage) &&
      previous &&
      canMerge(previous, cue, translation.targetLanguage)
    ) {
      phrases[phrases.length - 1] = merge(
        previous,
        cue,
        translation.targetLanguage,
      );
    } else {
      phrases.push(cue);
    }
  }

  for (let index = phrases.length - 2; index >= 0; index -= 1) {
    const current = phrases[index]!;
    const next = phrases[index + 1]!;
    if (
      (isShort(current.text, translation.targetLanguage) ||
        needsContinuation(current.text, translation.targetLanguage)) &&
      canMerge(current, next, translation.targetLanguage)
    ) {
      phrases.splice(
        index,
        2,
        merge(current, next, translation.targetLanguage),
      );
    }
  }

  return Object.freeze(
    phrases.map((phrase) =>
      Object.freeze({
        ...phrase,
        sourceCueIds: Object.freeze([...phrase.sourceCueIds]),
        spokenText:
          translation.targetLanguage === 'zh-Hans'
            ? normalizeChineseSpokenText(phrase.text)
            : phrase.text,
      }),
    ),
  );
}
