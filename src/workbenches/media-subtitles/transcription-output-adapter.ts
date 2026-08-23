import type {
  SubtitleCueV1,
  SubtitleLanguage,
} from './contracts';
import {
  segmentSubtitleTokens,
  type TimestampedSubtitleToken,
} from './subtitle-cue-segmenter';

interface WhisperJsonSegment {
  readonly offsets?: { readonly from?: unknown; readonly to?: unknown };
  readonly text?: unknown;
  readonly tokens?: readonly WhisperJsonToken[];
}

interface WhisperJsonToken {
  readonly offsets?: { readonly from?: unknown; readonly to?: unknown };
  readonly text?: unknown;
  readonly t_dtw?: unknown;
}

interface WhisperJsonOutput {
  readonly result?: { readonly language?: unknown };
  readonly transcription?: readonly WhisperJsonSegment[];
}

interface SenseVoiceSegment {
  readonly language: string;
  readonly text: string;
}

interface VadSegment {
  readonly startMs: number;
  readonly endMs: number;
}

interface WhisperTokenCandidate {
  readonly alignmentMs?: number;
  readonly endMs?: number;
  readonly id: string;
  readonly segmentId: string;
  readonly startMs?: number;
  readonly text: string;
}

export interface ParsedTranscriptionOutput {
  readonly language: SubtitleLanguage;
  readonly cues: readonly SubtitleCueV1[];
}

function normalizedLanguage(value: unknown): SubtitleLanguage {
  if (typeof value !== 'string') return 'unknown';
  const language = value.trim().toLowerCase().replaceAll('_', '-');

  if (language === 'en' || language.startsWith('en-')) return 'en';
  if (
    language === 'zh' ||
    language.startsWith('zh-') ||
    language === 'chinese'
  ) {
    return 'zh-Hans';
  }
  return 'unknown';
}

function finiteTime(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error('字幕时间戳无效');
  }
  return Math.round(number);
}

function optionalTime(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.round(number)
    : undefined;
}

function optionalDtwTime(value: unknown): number | undefined {
  const centiseconds = Number(value);
  if (!Number.isSafeInteger(centiseconds) || centiseconds < 0) {
    return undefined;
  }
  const milliseconds = centiseconds * 10;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function comparableText(value: string): string {
  return value.replace(/\s+/gu, '').trim();
}

function isWhisperSpecialToken(value: string): boolean {
  const text = value.trim();
  return text.startsWith('[_') && text.endsWith(']');
}

function whisperTokens(
  output: WhisperJsonOutput,
): readonly TimestampedSubtitleToken[] | undefined {
  if (!Array.isArray(output.transcription)) return undefined;

  const candidates: WhisperTokenCandidate[] = [];

  for (
    let segmentIndex = 0;
    segmentIndex < output.transcription.length;
    segmentIndex += 1
  ) {
    const segment = output.transcription[segmentIndex];
    const segmentText = String(segment.text ?? '').trim();
    if (!segmentText) continue;
    if (!Array.isArray(segment.tokens)) return undefined;

    const contentTokens: WhisperTokenCandidate[] = [];
    for (
      let tokenIndex = 0;
      tokenIndex < segment.tokens.length;
      tokenIndex += 1
    ) {
      const token = segment.tokens[tokenIndex];
      const text = String(token.text ?? '');
      if (!text.trim() || isWhisperSpecialToken(text)) continue;
      const startMs = optionalTime(token.offsets?.from);
      const endMs = optionalTime(token.offsets?.to);
      const alignmentMs = optionalDtwTime(token.t_dtw);
      contentTokens.push({
        alignmentMs,
        endMs,
        id: `raw-${String(segmentIndex + 1).padStart(6, '0')}-${String(tokenIndex + 1).padStart(6, '0')}`,
        segmentId: `raw-segment-${String(segmentIndex + 1).padStart(6, '0')}`,
        startMs,
        text,
      });
    }

    if (
      contentTokens.length === 0 ||
      comparableText(contentTokens.map(({ text }) => text).join('')) !==
        comparableText(segmentText)
    ) {
      return undefined;
    }
    candidates.push(...contentTokens);
  }

  if (candidates.length === 0) return undefined;

  const hasValidDtwTimeline = candidates.every((token, index) =>
    token.alignmentMs !== undefined &&
    (index === 0 || token.alignmentMs >= candidates[index - 1].alignmentMs!),
  );
  if (hasValidDtwTimeline) {
    return candidates.map((token) => ({
      id: token.id,
      segmentId: token.segmentId,
      startMs: token.alignmentMs!,
      endMs: token.alignmentMs!,
      text: token.text,
    }));
  }

  const hasValidOffsetTimeline = candidates.every((token, index) =>
    token.startMs !== undefined &&
    token.endMs !== undefined &&
    token.endMs >= token.startMs &&
    (index === 0 || token.startMs >= candidates[index - 1].startMs!),
  );
  if (!hasValidOffsetTimeline) return undefined;
  return candidates.map((token) => ({
    id: token.id,
    segmentId: token.segmentId,
    startMs: token.startMs!,
    endMs: token.endMs!,
    text: token.text,
  }));
}

function whisperSegmentCues(
  output: WhisperJsonOutput,
): readonly SubtitleCueV1[] {
  if (!Array.isArray(output.transcription)) {
    throw new Error('Whisper 没有返回 transcription 数组');
  }

  return output.transcription.flatMap((segment, index) => {
    const text = String(segment.text ?? '').replace(/\s+/gu, ' ').trim();
    if (!text) return [];
    const startMs = finiteTime(segment.offsets?.from);
    const endMs = finiteTime(segment.offsets?.to);
    if (endMs <= startMs) throw new Error('Whisper 返回了无效时间段');
    const id = `raw-${String(index + 1).padStart(6, '0')}`;
    return [{
      id,
      startMs,
      endMs,
      text,
      sourceCueIds: [id],
    }];
  });
}

function joinCueText(
  current: string,
  next: string,
  language: SubtitleLanguage,
): string {
  if (!current) return next;
  if (language !== 'zh-Hans') return `${current} ${next}`;
  const boundaryHasLatinText =
    /[\p{Letter}\p{Number}]$/u.test(current) &&
    /^(?:[A-Za-z0-9]|\p{Script=Han})/u.test(next) &&
    (/[A-Za-z0-9]$/u.test(current) || /^[A-Za-z0-9]/u.test(next));
  return `${current}${boundaryHasLatinText ? ' ' : ''}${next}`;
}

export function mergeWhisperSubtitleCues(
  source: readonly SubtitleCueV1[],
  language: SubtitleLanguage,
): readonly SubtitleCueV1[] {
  const maximumCharacters = language === 'zh-Hans' ? 64 : 180;
  const result: SubtitleCueV1[] = [];
  let group: SubtitleCueV1[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const id = `cue-${String(result.length + 1).padStart(6, '0')}`;
    result.push({
      id,
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
      text: group.reduce(
        (text, cue) => joinCueText(text, cue.text, language),
        '',
      ),
      sourceCueIds: group.flatMap(({ sourceCueIds }) => sourceCueIds),
    });
    group = [];
  };

  for (const cue of source) {
    const first = group[0];
    const previous = group[group.length - 1];
    const joinedText = group.reduce(
      (text, item) => joinCueText(text, item.text, language),
      '',
    );
    const candidateText = joinCueText(joinedText, cue.text, language);
    if (
      first &&
      previous &&
      (cue.startMs - previous.endMs > 700 ||
        cue.endMs - first.startMs > 8_000 ||
        [...candidateText].length > maximumCharacters)
    ) {
      flush();
    }
    group.push(cue);
    if (/[。！？!?…]["'”’）》】]*$/u.test(cue.text)) flush();
  }
  flush();
  return result;
}

export function parseWhisperTranscription(
  value: unknown,
): ParsedTranscriptionOutput {
  const output = value as WhisperJsonOutput;
  const language = normalizedLanguage(output.result?.language);
  const timestampedTokens = whisperTokens(output);
  return {
    language,
    cues: timestampedTokens
      ? segmentSubtitleTokens(timestampedTokens, language)
      : mergeWhisperSubtitleCues(whisperSegmentCues(output), language),
  };
}

function parseVadSegments(source: string): readonly VadSegment[] {
  const segments: VadSegment[] = [];
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
    const startMs = Number(match[1]);
    const endMs = Number(match[2]);
    if (endMs <= startMs) {
      throw new Error('FSMN-VAD 返回了无效时间段');
    }
    segments.push({ startMs, endMs });
  }
  if (segments.length === 0) throw new Error('FSMN-VAD 没有检测到语音');
  return segments;
}

function parseSenseVoiceSegments(source: string): readonly SenseVoiceSegment[] {
  const pattern =
    /<\|([^|]+)\|><\|([^|]+)\|><\|([^|]+)\|><\|([^|]+)\|>([\s\S]*?)(?=<\|[^|]+\|><\|[^|]+\|><\|[^|]+\|><\|[^|]+\|>|$)/gu;
  const segments = Array.from(source.matchAll(pattern), (match) => ({
    language: match[1],
    text: match[5].replace(/\s+/gu, ' ').trim(),
  })).filter(({ text }) => text.length > 0);
  if (segments.length === 0) {
    throw new Error('SenseVoice 没有返回可用文本');
  }
  return segments;
}

export function parseSenseVoiceTranscription(
  vadOutput: string,
  recognitionOutput: string,
): ParsedTranscriptionOutput {
  const timings = parseVadSegments(vadOutput);
  const recognized = parseSenseVoiceSegments(recognitionOutput);
  if (timings.length !== recognized.length) {
    throw new Error(
      `SenseVoice/VAD 分段数不一致：${recognized.length}/${timings.length}`,
    );
  }

  const languages = new Set(recognized.map(({ language }) =>
    normalizedLanguage(language),
  ));
  return {
    language: languages.size === 1 ? [...languages][0] : 'unknown',
    cues: timings.map((timing, index) => {
      const id = `cue-${String(index + 1).padStart(6, '0')}`;
      return {
        id,
        startMs: timing.startMs,
        endMs: timing.endMs,
        text: recognized[index].text,
        sourceCueIds: [id],
      };
    }),
  };
}
