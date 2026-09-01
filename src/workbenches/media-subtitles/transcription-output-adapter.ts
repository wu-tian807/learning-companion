import type {
  SubtitleCueV1,
  SubtitleLanguage,
  SubtitleSpeakerSegmentV1,
} from './contracts';
import {
  segmentSubtitleTokens,
  type TimestampedSubtitleToken,
} from './subtitle-cue-segmenter';

interface WhisperToken {
  readonly offsets?: { readonly from?: unknown; readonly to?: unknown };
  readonly text?: unknown;
  readonly t_dtw?: unknown;
}

interface WhisperSegment {
  readonly offsets?: { readonly from?: unknown; readonly to?: unknown };
  readonly text?: unknown;
  readonly tokens?: readonly WhisperToken[];
}

interface WhisperOutput {
  readonly result?: { readonly language?: unknown };
  readonly transcription?: readonly WhisperSegment[];
}

export interface ParsedTranscriptionOutput {
  readonly language: SubtitleLanguage;
  readonly cues: readonly SubtitleCueV1[];
}

function subtitleLanguage(value: unknown): SubtitleLanguage {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase().replaceAll('_', '-');
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  return normalized === 'zh' ||
    normalized === 'chinese' ||
    normalized.startsWith('zh-')
    ? 'zh-Hans'
    : 'unknown';
}

function time(value: unknown, scale = 1): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * scale)
    : undefined;
}

function whisperTokens(
  segments: readonly WhisperSegment[],
): readonly TimestampedSubtitleToken[] | undefined {
  const tokens: Array<{
    id: string;
    segmentId: string;
    text: string;
    startMs?: number;
    endMs?: number;
    dtwMs?: number;
  }> = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    const expectedText = String(segment.text ?? '').replace(/\s+/gu, '');
    if (!expectedText) continue;
    if (!Array.isArray(segment.tokens)) return undefined;
    const content = segment.tokens.flatMap((token, tokenIndex) => {
      const text = String(token.text ?? '');
      if (!text.trim() || /^\[_.*\]$/u.test(text.trim())) return [];
      return [
        {
          id: `raw-${String(segmentIndex + 1).padStart(6, '0')}-${String(tokenIndex + 1).padStart(6, '0')}`,
          segmentId: `raw-segment-${String(segmentIndex + 1).padStart(6, '0')}`,
          text,
          startMs: time(token.offsets?.from),
          endMs: time(token.offsets?.to),
          dtwMs: Number.isSafeInteger(token.t_dtw)
            ? time(token.t_dtw, 10)
            : undefined,
        },
      ];
    });
    if (
      content.length === 0 ||
      content
        .map(({ text }) => text)
        .join('')
        .replace(/\s+/gu, '') !== expectedText
    ) {
      return undefined;
    }
    tokens.push(...content);
  }
  if (tokens.length === 0) return undefined;

  const monotonic = (field: 'dtwMs' | 'startMs') =>
    tokens.every(
      (token, index) =>
        token[field] !== undefined &&
        (index === 0 || token[field]! >= tokens[index - 1]![field]!),
    );
  const useDtw = monotonic('dtwMs');
  if (
    !useDtw &&
    (!monotonic('startMs') ||
      tokens.some(
        ({ startMs, endMs }) => endMs === undefined || endMs < startMs!,
      ))
  ) {
    return undefined;
  }
  return tokens.map((token) => ({
    id: token.id,
    segmentId: token.segmentId,
    startMs: useDtw ? token.dtwMs! : token.startMs!,
    endMs: useDtw ? token.dtwMs! : token.endMs!,
    text: token.text,
  }));
}

function fallbackWhisperCues(
  segments: readonly WhisperSegment[],
  language: SubtitleLanguage,
): readonly SubtitleCueV1[] {
  let previousText = '';
  const tokens = segments.flatMap((segment, index) => {
    const rawText = String(segment.text ?? '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!rawText) return [];
    const startMs = time(segment.offsets?.from);
    const endMs = time(segment.offsets?.to);
    if (startMs === undefined || endMs === undefined || endMs <= startMs) {
      throw new Error('Whisper 返回了无效时间段');
    }
    const id = `raw-${String(index + 1).padStart(6, '0')}`;
    const separate =
      previousText.length > 0 &&
      (language !== 'zh-Hans' ||
        /[A-Za-z0-9]$/u.test(previousText) ||
        /^[A-Za-z0-9]/u.test(rawText));
    const text = `${separate ? ' ' : ''}${rawText}`;
    previousText += text;
    return [{ id, segmentId: id, startMs, endMs, text }];
  });
  return segmentSubtitleTokens(tokens, language);
}

export function parseWhisperTranscription(
  value: unknown,
): ParsedTranscriptionOutput {
  const output = value as WhisperOutput;
  if (!Array.isArray(output.transcription)) {
    throw new Error('Whisper 没有返回 transcription 数组');
  }
  const language = subtitleLanguage(output.result?.language);
  const tokens = whisperTokens(output.transcription);
  return {
    language,
    cues: tokens
      ? segmentSubtitleTokens(tokens, language)
      : fallbackWhisperCues(output.transcription, language),
  };
}

export function parseSenseVoiceTranscription(
  vadOutput: string,
  recognitionOutput: string,
): ParsedTranscriptionOutput {
  const timings = vadOutput.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) return [];
    const startMs = Number(match[1]);
    const endMs = Number(match[2]);
    if (endMs <= startMs) throw new Error('FSMN-VAD 返回了无效时间段');
    return [{ startMs, endMs }];
  });
  const pattern =
    /<\|([^|]+)\|><\|[^|]+\|><\|[^|]+\|><\|[^|]+\|>([\s\S]*?)(?=<\|[^|]+\|><\|[^|]+\|><\|[^|]+\|><\|[^|]+\|>|$)/gu;
  const recognized = Array.from(
    recognitionOutput.matchAll(pattern),
    (match) => ({
      language: subtitleLanguage(match[1]),
      text: match[2].replace(/\s+/gu, ' ').trim(),
    }),
  ).filter(({ text }) => text.length > 0);
  if (timings.length === 0) throw new Error('FSMN-VAD 没有检测到语音');
  if (recognized.length === 0) throw new Error('SenseVoice 没有返回可用文本');
  if (timings.length !== recognized.length) {
    throw new Error(
      `SenseVoice/VAD 分段数不一致：${recognized.length}/${timings.length}`,
    );
  }
  const languages = new Set(recognized.map(({ language }) => language));
  return {
    language: languages.size === 1 ? [...languages][0]! : 'unknown',
    cues: timings.map((timing, index) => {
      const id = `cue-${String(index + 1).padStart(6, '0')}`;
      return {
        id,
        ...timing,
        text: recognized[index]!.text,
        sourceCueIds: [id],
      };
    }),
  };
}

export function parseSherpaSpeakerDiarization(
  output: string,
): readonly SubtitleSpeakerSegmentV1[] {
  const parsed = output.split(/\r?\n/u).flatMap((line) => {
    const match =
      /^\s*(\d+(?:\.\d+)?)\s+--\s+(\d+(?:\.\d+)?)\s+speaker_(\d+)\s*$/u.exec(
        line,
      );
    if (!match) return [];
    const startMs = Math.round(Number(match[1]) * 1_000);
    const endMs = Math.round(Number(match[2]) * 1_000);
    if (endMs <= startMs) {
      throw new Error('Sherpa-ONNX 返回了无效说话人片段');
    }
    return [{ rawSpeakerId: match[3], startMs, endMs }];
  });
  parsed.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.rawSpeakerId.localeCompare(right.rawSpeakerId),
  );
  if (parsed.length === 0) throw new Error('Sherpa-ONNX 没有返回说话人片段');
  const ids = new Map<string, string>();
  return parsed.map(({ rawSpeakerId, startMs, endMs }) => {
    const speakerId =
      ids.get(rawSpeakerId) ??
      `speaker-${String(ids.size + 1).padStart(4, '0')}`;
    ids.set(rawSpeakerId, speakerId);
    return { speakerId, startMs, endMs };
  });
}

function speakerForCue(
  cue: SubtitleCueV1,
  segments: readonly SubtitleSpeakerSegmentV1[],
): string {
  const overlap = new Map<string, number>();
  for (const segment of segments) {
    overlap.set(
      segment.speakerId,
      (overlap.get(segment.speakerId) ?? 0) +
        Math.max(
          0,
          Math.min(cue.endMs, segment.endMs) -
            Math.max(cue.startMs, segment.startMs),
        ),
    );
  }
  const dominant = [...overlap].sort(
    ([leftId, left], [rightId, right]) =>
      right - left || leftId.localeCompare(rightId),
  )[0];
  if (dominant && dominant[1] > 0) return dominant[0];
  const midpoint = (cue.startMs + cue.endMs) / 2;
  return [...segments].sort((left, right) => {
    const distance = (segment: SubtitleSpeakerSegmentV1) =>
      Math.min(
        Math.abs(midpoint - segment.startMs),
        Math.abs(midpoint - segment.endMs),
      );
    return distance(left) - distance(right);
  })[0]!.speakerId;
}

export function addPostHocSpeakerAnalysis(
  cues: readonly SubtitleCueV1[],
  segments: readonly SubtitleSpeakerSegmentV1[],
) {
  if (segments.length === 0) throw new Error('缺少说话人分析片段');
  return {
    cues: cues.map((cue) => ({
      ...cue,
      speakerId: speakerForCue(cue, segments),
    })),
    speakerAnalysis: {
      method: 'post-hoc-diarization' as const,
      supportsOverlappingTranscription: false,
      segments,
    },
  };
}
