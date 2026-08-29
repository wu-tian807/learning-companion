const MAXIMUM_MERGE_GAP_MS = 700;
const MAXIMUM_PHRASE_DURATION_MS = 8_000;
const CHINESE_SHORT_CHARACTER_COUNT = 4;
const ENGLISH_SHORT_WORD_COUNT = 2;
const CHINESE_MAXIMUM_CHARACTER_COUNT = 34;
const ENGLISH_MAXIMUM_WORD_COUNT = 18;
export const DUBBING_PHRASE_PLANNER_VERSION = 2;
const ENGLISH_CONTINUATION_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "by",
  "and",
  "or",
  "but",
]);

const CHINESE_DIGITS = Object.freeze([
  "零",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
]);
const CHINESE_UNITS = Object.freeze([
  "",
  "十",
  "百",
  "千",
  "万",
  "十万",
  "百万",
  "千万",
  "亿",
  "十亿",
  "百亿",
  "千亿",
  "兆",
]);

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

function digitsIndividually(value) {
  return [...value].map((digit) => CHINESE_DIGITS[Number(digit)]).join("");
}

function integerToChinese(value) {
  const digits = value.replaceAll(",", "");
  if (!/^\d+$/u.test(digits)) return value;
  if (digits === "0") return CHINESE_DIGITS[0];
  if (digits.length > CHINESE_UNITS.length || /^0\d/u.test(digits)) {
    return digitsIndividually(digits);
  }

  let result = "";
  let pendingZero = false;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    const unitIndex = digits.length - index - 1;
    if (digit === 0) {
      if (result && [...digits.slice(index + 1)].some((next) => next !== "0")) {
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
  return result.replace(/^一十/u, "十");
}

function decimalToChinese(value) {
  const [integer, fraction] = value.replaceAll(",", "").split(".");
  if (fraction === undefined) return integerToChinese(integer);
  return `${integerToChinese(integer)}点${digitsIndividually(fraction)}`;
}

export function normalizeChineseSpokenText(value) {
  const text = cleanText(value);
  return text.replace(
    /(\d{1,2}):(\d{2})|(\d[\d,]*(?:\.\d+)?)%|(\d{4})(?=年)|\d[\d,]*(?:\.\d+)?/gu,
    (match, hour, minute, percent, year) => {
      if (hour !== undefined) {
        const spokenMinute = minute.startsWith("0")
          ? digitsIndividually(minute)
          : integerToChinese(minute);
        return `${integerToChinese(hour)}点${spokenMinute}分`;
      }
      if (percent !== undefined) return `百分之${decimalToChinese(percent)}`;
      if (year !== undefined) return digitsIndividually(year);
      return decimalToChinese(match);
    },
  );
}

function meaningfulChineseCharacters(text) {
  return [...text].filter((character) => /[\p{L}\p{N}]/u.test(character))
    .length;
}

function englishWords(text) {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

function isShort(text, language) {
  return language === "zh-Hans"
    ? meaningfulChineseCharacters(text) <= CHINESE_SHORT_CHARACTER_COUNT
    : englishWords(text).length <= ENGLISH_SHORT_WORD_COUNT;
}

function needsContinuation(text, language) {
  if (language === "zh-Hans") {
    return /[的地得把被将向在为从到与和或及并而但由让给跟对以于]$/u.test(text);
  }
  const lastWord = englishWords(text).at(-1)?.toLowerCase();
  return ENGLISH_CONTINUATION_WORDS.has(lastWord);
}

function shouldMerge(text, language) {
  return isShort(text, language) || needsContinuation(text, language);
}

function withinTextLimit(text, language) {
  return language === "zh-Hans"
    ? meaningfulChineseCharacters(text) <= CHINESE_MAXIMUM_CHARACTER_COUNT
    : englishWords(text).length <= ENGLISH_MAXIMUM_WORD_COUNT;
}

function joinText(left, right, language) {
  if (language !== "zh-Hans") return `${left} ${right}`.replace(/\s+/gu, " ");
  if (needsContinuation(left, language)) return `${left}${right}`;
  if (/[。！？，；：…]$/u.test(left)) return `${left}${right}`;
  return `${left}，${right}`;
}

function joinSourceText(left, right) {
  if (/\p{Script=Han}/u.test(left) || /\p{Script=Han}/u.test(right)) {
    return `${left}${right}`;
  }
  return `${left} ${right}`.replace(/\s+/gu, " ");
}

function canMerge(left, right, language) {
  const gap = right.startMs - left.endMs;
  if (gap < 0 || gap > MAXIMUM_MERGE_GAP_MS) return false;
  if (right.endMs - left.startMs > MAXIMUM_PHRASE_DURATION_MS) return false;
  return withinTextLimit(joinText(left.text, right.text, language), language);
}

function merge(left, right, language) {
  return {
    id: left.id,
    startMs: left.startMs,
    endMs: right.endMs,
    text: joinText(left.text, right.text, language),
    sourceText: joinSourceText(left.sourceText, right.sourceText),
    sourceCueIds: [...left.sourceCueIds, ...right.sourceCueIds],
  };
}

function validateInput(cues) {
  let previousEnd = -1;
  return cues.map((cue, index) => {
    const id = cleanText(cue?.id);
    const text = cleanText(cue?.text);
    const sourceText = cleanText(cue?.sourceText);
    const startMs = cue?.startMs;
    const endMs = cue?.endMs;
    if (
      !id ||
      !text ||
      !sourceText ||
      !Number.isSafeInteger(startMs) ||
      !Number.isSafeInteger(endMs) ||
      startMs < previousEnd ||
      endMs <= startMs
    ) {
      throw new Error(`invalid translated cue at index ${index}`);
    }
    previousEnd = endMs;
    return {
      id,
      startMs,
      endMs,
      text,
      sourceText,
      sourceCueIds: Array.isArray(cue.sourceCueIds)
        ? [...cue.sourceCueIds]
        : [id],
    };
  });
}

export function createDubbingPhrases(cues, targetLanguage) {
  if (targetLanguage !== "zh-Hans" && targetLanguage !== "en") {
    throw new Error(`unsupported dubbing language: ${targetLanguage}`);
  }
  const input = validateInput(cues);
  const phrases = [];

  for (const cue of input) {
    const previous = phrases.at(-1);
    if (
      isShort(cue.text, targetLanguage) &&
      !needsContinuation(cue.text, targetLanguage) &&
      previous &&
      canMerge(previous, cue, targetLanguage)
    ) {
      phrases[phrases.length - 1] = merge(previous, cue, targetLanguage);
    } else {
      phrases.push(cue);
    }
  }

  for (let index = phrases.length - 2; index >= 0; index -= 1) {
    const current = phrases[index];
    const next = phrases[index + 1];
    if (
      shouldMerge(current.text, targetLanguage) &&
      canMerge(current, next, targetLanguage)
    ) {
      phrases.splice(index, 2, merge(current, next, targetLanguage));
    }
  }

  return phrases.map((phrase) =>
    Object.freeze({
      ...phrase,
      spokenText:
        targetLanguage === "zh-Hans"
          ? normalizeChineseSpokenText(phrase.text)
          : phrase.text,
    }),
  );
}
