import type {
  SubtitleCueV1,
  SubtitleLanguage,
  SubtitleSpeakerAnalysisV1,
} from './contracts';

export interface TimestampedSubtitleToken {
  readonly id: string;
  readonly segmentId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

type BoundaryKind =
  | 'clause'
  | 'final'
  | 'pause'
  | 'segment'
  | 'sentence'
  | 'token'
  | 'word';

interface SegmentationProfile {
  readonly idealCharacters: number;
  readonly maximumCharacters: number;
}

interface PathEntry {
  readonly cost: number;
  readonly previous: number;
}

const IDEAL_DURATION_MS = 3_200;
const MAXIMUM_DURATION_MS = 6_000;
const MINIMUM_DURATION_MS = 800;
const PAUSE_BOUNDARY_MS = 250;
const ALIGNMENT_POINT_PAUSE_MS = 700;
const MAXIMUM_INTERNAL_GAP_MS = 700;
const ALIGNMENT_POINT_PREROLL_MS = 250;
const ALIGNMENT_POINT_POSTROLL_MS = 200;
const MINIMUM_REPAIR_DISPLAY_WINDOW_MS = 200;
const REPAIR_DISPLAY_WINDOW_MS =
  ALIGNMENT_POINT_PREROLL_MS + ALIGNMENT_POINT_POSTROLL_MS;

const SENTENCE_END = /[。！？!?…]["'”’）》】]*$/u;
const CLAUSE_END = /[，,；;：:、]["'”’）》】]*$/u;

function profile(language: SubtitleLanguage): SegmentationProfile {
  return language === 'zh-Hans'
    ? { idealCharacters: 22, maximumCharacters: 30 }
    : { idealCharacters: 56, maximumCharacters: 72 };
}

function visibleCharacterCount(
  value: string,
  language: SubtitleLanguage,
): number {
  const normalized = language === 'zh-Hans'
    ? value.replace(/\s+/gu, '')
    : value.replace(/\s+/gu, ' ').trim();
  return [...normalized].length;
}

function cueText(tokens: readonly TimestampedSubtitleToken[]): string {
  return tokens
    .map(({ text }) => text)
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

function wordBoundaryOffsets(
  text: string,
  language: SubtitleLanguage,
): ReadonlySet<number> {
  const locale = language === 'zh-Hans'
    ? 'zh-CN'
    : language === 'en'
      ? 'en'
      : undefined;
  const result = new Set<number>();
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });

  for (const part of segmenter.segment(text)) {
    if (part.isWordLike) result.add(part.index + part.segment.length);
  }
  return result;
}

function boundaryKind(
  tokens: readonly TimestampedSubtitleToken[],
  end: number,
  tokenEndOffsets: readonly number[],
  wordBoundaries: ReadonlySet<number>,
  pointAligned: boolean,
): BoundaryKind {
  if (end === tokens.length) return 'final';
  const current = tokens[end - 1];
  const next = tokens[end];
  const currentText = current.text.trimEnd();

  if (SENTENCE_END.test(currentText)) return 'sentence';
  if (CLAUSE_END.test(currentText)) return 'clause';
  const pauseBoundary = pointAligned
    ? ALIGNMENT_POINT_PAUSE_MS
    : PAUSE_BOUNDARY_MS;
  if (next.startMs - current.endMs >= pauseBoundary) return 'pause';
  if (current.segmentId !== next.segmentId) return 'segment';
  if (wordBoundaries.has(tokenEndOffsets[end])) return 'word';
  return 'token';
}

function applyAlignmentPointDisplayWindow(
  cues: readonly SubtitleCueV1[],
): readonly SubtitleCueV1[] {
  const result = cues.map((cue) => ({
    ...cue,
    startMs: Math.max(0, cue.startMs - ALIGNMENT_POINT_PREROLL_MS),
    endMs: cue.endMs + ALIGNMENT_POINT_POSTROLL_MS,
  }));

  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (previous.endMs <= current.startMs) continue;

    const previousPoint = cues[index - 1].endMs;
    const currentPoint = cues[index].startMs;
    const boundary = Math.round((previousPoint + currentPoint) / 2);
    previous.endMs = boundary;
    current.startMs = boundary;
  }
  return result;
}

export interface ZeroDurationSubtitleCueRepairOptions {
  readonly speakerAnalysis?: SubtitleSpeakerAnalysisV1;
}

function createRepairDisplayWindow(
  pointMs: number,
  lowerBoundMs: number,
  upperBoundMs: number,
): readonly [startMs: number, endMs: number] {
  const preferredStartMs = Math.max(
    lowerBoundMs,
    pointMs - ALIGNMENT_POINT_PREROLL_MS,
  );
  const preferredEndMs = Math.min(
    upperBoundMs,
    pointMs + ALIGNMENT_POINT_POSTROLL_MS,
  );
  if (
    preferredEndMs - preferredStartMs >= MINIMUM_REPAIR_DISPLAY_WINDOW_MS
  ) {
    return [preferredStartMs, preferredEndMs];
  }

  const availableMs = upperBoundMs - lowerBoundMs;
  if (availableMs < MINIMUM_REPAIR_DISPLAY_WINDOW_MS) {
    throw new Error('字幕零时长 Cue 没有可用的显示窗口');
  }

  const widthMs = Math.min(REPAIR_DISPLAY_WINDOW_MS, availableMs);
  const startMs = Math.min(
    Math.max(lowerBoundMs, pointMs - ALIGNMENT_POINT_PREROLL_MS),
    upperBoundMs - widthMs,
  );
  return [startMs, startMs + widthMs];
}

function speakerBoundsForCue(
  cue: SubtitleCueV1,
  speakerAnalysis: SubtitleSpeakerAnalysisV1 | undefined,
): readonly [startMs: number, endMs: number] | undefined {
  if (!speakerAnalysis || cue.speakerId === undefined) return undefined;
  const candidates = speakerAnalysis.segments
    .filter(
      (segment) =>
        segment.speakerId === cue.speakerId &&
        cue.startMs >= segment.startMs &&
        cue.startMs <= segment.endMs,
    )
    .sort(
      (left, right) =>
        left.endMs - left.startMs - (right.endMs - right.startMs),
    );
  const segment = candidates[0];
  if (!segment) {
    throw new Error(
      `字幕 Cue ${cue.id} 的时间点超出说话人 ${cue.speakerId} 边界，无法修复`,
    );
  }
  return [segment.startMs, segment.endMs];
}

function repairCueDisplayWindow(
  cue: SubtitleCueV1,
  index: number,
  cues: readonly SubtitleCueV1[],
  options: ZeroDurationSubtitleCueRepairOptions,
): SubtitleCueV1 {
  if (cue.endMs > cue.startMs) return cue;
  if (cue.endMs < cue.startMs) {
    throw new Error(`字幕 Cue ${cue.id} 的 endMs 早于 startMs`);
  }

  const speakerBounds = speakerBoundsForCue(cue, options.speakerAnalysis);
  const lowerBoundMs = speakerBounds?.[0] ?? 0;
  const upperBoundMs = speakerBounds?.[1] ?? Number.POSITIVE_INFINITY;
  const previous = cues[index - 1];
  const next = cues[index + 1];
  const hasPreviousGap = previous === undefined || previous.endMs <= cue.startMs;
  const hasNextGap = next === undefined || cue.startMs <= next.startMs;

  let window: readonly [startMs: number, endMs: number];
  if (hasPreviousGap && hasNextGap) {
    try {
      window = createRepairDisplayWindow(
        cue.startMs,
        Math.max(lowerBoundMs, previous?.endMs ?? lowerBoundMs),
        Math.min(upperBoundMs, next?.startMs ?? upperBoundMs),
      );
    } catch {
      window = createRepairDisplayWindow(
        cue.startMs,
        lowerBoundMs,
        upperBoundMs,
      );
    }
  } else {
    window = createRepairDisplayWindow(
      cue.startMs,
      lowerBoundMs,
      upperBoundMs,
    );
  }

  return {
    ...cue,
    startMs: window[0],
    endMs: window[1],
  };
}

/** Repairs only zero-duration cues; all valid cues retain their original timing. */
export function repairZeroDurationSubtitleCues(
  cues: readonly SubtitleCueV1[],
  options: ZeroDurationSubtitleCueRepairOptions = {},
): readonly SubtitleCueV1[] {
  if (cues.length === 0) return cues;
  return Object.freeze(
    cues.map((cue, index) =>
      repairCueDisplayWindow(cue, index, cues, options),
    ),
  );
}

function boundaryPenalty(kind: BoundaryKind, pointAligned: boolean): number {
  switch (kind) {
    case 'final':
    case 'sentence':
      return 0;
    case 'clause':
      return 1;
    case 'pause':
      return 3;
    case 'segment':
      return pointAligned ? 0 : 4;
    case 'word':
      return 8;
    case 'token':
      return 80;
  }
}

function edgeCost(
  durationMs: number,
  characters: number,
  idealCharacters: number,
  kind: BoundaryKind,
  pointAligned: boolean,
): number {
  let cost = 4 + boundaryPenalty(kind, pointAligned);
  cost += Math.abs(durationMs - IDEAL_DURATION_MS) / 800;
  if (durationMs < MINIMUM_DURATION_MS) {
    cost += (MINIMUM_DURATION_MS - durationMs) / 100;
  }
  if (characters > idealCharacters) {
    cost += (characters - idealCharacters) * 1.5;
  }
  return cost;
}

function validateTokens(tokens: readonly TimestampedSubtitleToken[]): void {
  const ids = new Set<string>();
  let previousStart = -1;

  for (const token of tokens) {
    if (
      !token.id ||
      !token.segmentId ||
      !token.text ||
      !Number.isSafeInteger(token.startMs) ||
      !Number.isSafeInteger(token.endMs) ||
      token.startMs < 0 ||
      token.endMs < token.startMs ||
      token.startMs < previousStart ||
      ids.has(token.id)
    ) {
      throw new Error('字幕 Token 时间轴无效');
    }
    ids.add(token.id);
    previousStart = token.startMs;
  }
}

function createTokenEndOffsets(
  tokens: readonly TimestampedSubtitleToken[],
): readonly number[] {
  const offsets = [0];
  for (const token of tokens) {
    offsets.push(offsets[offsets.length - 1] + token.text.length);
  }
  return offsets;
}

export function segmentSubtitleTokens(
  tokens: readonly TimestampedSubtitleToken[],
  language: SubtitleLanguage,
): readonly SubtitleCueV1[] {
  if (tokens.length === 0) return [];
  validateTokens(tokens);
  const pointAligned = tokens.every(({ startMs, endMs }) => startMs === endMs);

  const joinedText = tokens.map(({ text }) => text).join('');
  const tokenEndOffsets = createTokenEndOffsets(tokens);
  const wordBoundaries = wordBoundaryOffsets(joinedText, language);
  const characterPrefix = [0];
  for (const token of tokens) {
    characterPrefix.push(
      characterPrefix[characterPrefix.length - 1] +
        visibleCharacterCount(token.text, language),
    );
  }

  const { idealCharacters, maximumCharacters } = profile(language);
  const paths = new Array<PathEntry | undefined>(tokens.length + 1);
  paths[0] = { cost: 0, previous: -1 };

  for (let start = 0; start < tokens.length; start += 1) {
    const path = paths[start];
    if (!path) continue;

    for (let end = start + 1; end <= tokens.length; end += 1) {
      if (
        end > start + 1 &&
        tokens[end - 1].startMs - tokens[end - 2].endMs >
          MAXIMUM_INTERNAL_GAP_MS
      ) {
        break;
      }
      const durationMs = tokens[end - 1].endMs - tokens[start].startMs;
      const characters = characterPrefix[end] - characterPrefix[start];
      const singleToken = end === start + 1;

      if (
        !singleToken &&
        (durationMs > MAXIMUM_DURATION_MS || characters > maximumCharacters)
      ) {
        break;
      }
      const kind = boundaryKind(
        tokens,
        end,
        tokenEndOffsets,
        wordBoundaries,
        pointAligned,
      );
      if (
        end < tokens.length &&
        (pointAligned
          ? tokens[end].startMs <= tokens[end - 1].endMs
          : tokens[end].startMs < tokens[end - 1].endMs)
      ) {
        continue;
      }

      const cost = path.cost + edgeCost(
        durationMs,
        characters,
        idealCharacters,
        kind,
        pointAligned,
      );
      const current = paths[end];
      if (!current || cost < current.cost) {
        paths[end] = { cost, previous: start };
      }
    }
  }

  if (!paths[tokens.length]) {
    throw new Error('字幕 Token 无法组成有效时间轴');
  }

  const boundaries = [tokens.length];
  let cursor = tokens.length;
  while (cursor > 0) {
    const entry = paths[cursor];
    if (!entry || entry.previous < 0) {
      throw new Error('字幕分段路径不完整');
    }
    boundaries.push(entry.previous);
    cursor = entry.previous;
  }
  boundaries.reverse();

  const cues = boundaries.slice(1).map((end, index) => {
    const start = boundaries[index];
    const cueTokens = tokens.slice(start, end);
    return {
      id: `cue-${String(index + 1).padStart(6, '0')}`,
      startMs: cueTokens[0].startMs,
      endMs: cueTokens[cueTokens.length - 1].endMs,
      text: cueText(cueTokens),
      sourceCueIds: cueTokens.map(({ id }) => id),
    };
  });
  return repairZeroDurationSubtitleCues(
    pointAligned ? applyAlignmentPointDisplayWindow(cues) : cues,
  );
}
