import type { SubtitleCueV1, SubtitleLanguage } from './contracts';

export interface TimestampedSubtitleToken {
  readonly id: string;
  readonly segmentId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

const MAXIMUM_DURATION_MS = 6_000;
const MAXIMUM_GAP_MS = 700;
const SENTENCE_END = /[。！？!?…]["'”’）》】]*$/u;
const CLAUSE_END = /[，,；;：:、]["'”’）》】]*$/u;

function characterCount(text: string, language: SubtitleLanguage): number {
  return [
    ...(language === 'zh-Hans'
      ? text.replace(/\s+/gu, '')
      : text.replace(/\s+/gu, ' ').trim()),
  ].length;
}

function validateTokens(tokens: readonly TimestampedSubtitleToken[]): void {
  const ids = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      !token.id ||
      !token.segmentId ||
      !token.text ||
      !Number.isSafeInteger(token.startMs) ||
      !Number.isSafeInteger(token.endMs) ||
      token.startMs < 0 ||
      token.endMs < token.startMs ||
      token.startMs < (tokens[index - 1]?.startMs ?? -1) ||
      ids.has(token.id)
    ) {
      throw new Error('字幕 Token 时间轴无效');
    }
    ids.add(token.id);
  }
}

function cueFromTokens(
  tokens: readonly TimestampedSubtitleToken[],
  index: number,
): SubtitleCueV1 {
  return {
    id: `cue-${String(index + 1).padStart(6, '0')}`,
    startMs: tokens[0]!.startMs,
    endMs: tokens.at(-1)!.endMs,
    text: tokens
      .map(({ text }) => text)
      .join('')
      .replace(/\s+/gu, ' ')
      .trim(),
    sourceCueIds: tokens.map(({ id }) => id),
  };
}

function expandAlignmentPoints(
  cues: readonly SubtitleCueV1[],
): readonly SubtitleCueV1[] {
  const expanded = cues.map((cue) => ({
    ...cue,
    startMs: Math.max(0, cue.startMs - 250),
    endMs: cue.endMs + 200,
  }));
  for (let index = 1; index < expanded.length; index += 1) {
    const previous = expanded[index - 1]!;
    const current = expanded[index]!;
    if (previous.endMs <= current.startMs) continue;
    const boundary = Math.round(
      (cues[index - 1]!.endMs + cues[index]!.startMs) / 2,
    );
    previous.endMs = boundary;
    current.startMs = boundary;
  }
  return expanded;
}

export function segmentSubtitleTokens(
  tokens: readonly TimestampedSubtitleToken[],
  language: SubtitleLanguage,
): readonly SubtitleCueV1[] {
  if (tokens.length === 0) return [];
  validateTokens(tokens);
  const maximumCharacters = language === 'zh-Hans' ? 30 : 72;
  const idealCharacters = language === 'zh-Hans' ? 22 : 56;
  const pointAligned = tokens.every(({ startMs, endMs }) => startMs === endMs);
  const groups: TimestampedSubtitleToken[][] = [];
  let current: TimestampedSubtitleToken[] = [];

  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  for (const token of tokens) {
    const first = current[0];
    const previous = current.at(-1);
    const candidateText = [...current, token].map(({ text }) => text).join('');
    if (
      first &&
      previous &&
      (token.startMs - previous.endMs > MAXIMUM_GAP_MS ||
        token.endMs - first.startMs > MAXIMUM_DURATION_MS ||
        characterCount(candidateText, language) > maximumCharacters)
    ) {
      flush();
    }
    current.push(token);
    const durationMs = token.endMs - current[0]!.startMs;
    const characters = characterCount(
      current.map(({ text }) => text).join(''),
      language,
    );
    if (
      (SENTENCE_END.test(token.text.trimEnd()) && durationMs >= 800) ||
      (CLAUSE_END.test(token.text.trimEnd()) &&
        (durationMs >= 2_400 || characters >= idealCharacters))
    ) {
      flush();
    }
  }
  flush();

  const cues = groups.map(cueFromTokens);
  return pointAligned ? expandAlignmentPoints(cues) : cues;
}
