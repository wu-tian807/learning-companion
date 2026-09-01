import {
  isSubtitleCueV1,
  isSubtitleSpeakerId,
  type SubtitleCueV1,
  type SubtitleLanguage,
  type SubtitleSpeakerAnalysisV1,
  type SubtitleSpeakerSegmentV1,
} from './contracts';

interface SenseVoiceSegment {
  readonly language: string;
  readonly text: string;
}

interface VadSegment {
  readonly startMs: number;
  readonly endMs: number;
}

export interface ParsedTranscriptionOutput {
  readonly language: SubtitleLanguage;
  readonly cues: readonly SubtitleCueV1[];
}

export interface ParsedMossTranscriptionOutput
  extends ParsedTranscriptionOutput {
  readonly speakerAnalysis: SubtitleSpeakerAnalysisV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizedSubtitleLanguage(value: unknown): SubtitleLanguage {
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

  const languages = new Set(
    recognized.map(({ language }) => normalizedSubtitleLanguage(language)),
  );
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

export function parseSherpaSpeakerDiarization(
  output: string,
): readonly SubtitleSpeakerSegmentV1[] {
  const raw: Array<{
    readonly rawSpeakerId: string;
    readonly startMs: number;
    readonly endMs: number;
  }> = [];
  for (const line of output.split(/\r?\n/u)) {
    const match =
      /^\s*(\d+(?:\.\d+)?)\s+--\s+(\d+(?:\.\d+)?)\s+speaker_(\d+)\s*$/u.exec(
        line,
      );
    if (!match) continue;
    const startMs = Math.round(Number(match[1]) * 1_000);
    const endMs = Math.round(Number(match[2]) * 1_000);
    if (endMs <= startMs) throw new Error('Sherpa-ONNX 返回了无效说话人片段');
    raw.push({ rawSpeakerId: match[3], startMs, endMs });
  }
  if (raw.length === 0) throw new Error('Sherpa-ONNX 没有返回说话人片段');
  raw.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.rawSpeakerId.localeCompare(right.rawSpeakerId),
  );
  const speakers = new Map<string, string>();
  return Object.freeze(
    raw.map((segment) => {
      let speakerId = speakers.get(segment.rawSpeakerId);
      if (!speakerId) {
        speakerId = `speaker-${String(speakers.size + 1).padStart(4, '0')}`;
        speakers.set(segment.rawSpeakerId, speakerId);
      }
      return Object.freeze({
        speakerId,
        startMs: segment.startMs,
        endMs: segment.endMs,
      });
    }),
  );
}

function overlapMs(
  startMs: number,
  endMs: number,
  segment: SubtitleSpeakerSegmentV1,
): number {
  return Math.max(
    0,
    Math.min(endMs, segment.endMs) - Math.max(startMs, segment.startMs),
  );
}

function speakerForCue(
  cue: SubtitleCueV1,
  segments: readonly SubtitleSpeakerSegmentV1[],
): string {
  const overlaps = new Map<string, number>();
  for (const segment of segments) {
    const overlap = overlapMs(cue.startMs, cue.endMs, segment);
    if (overlap > 0) {
      overlaps.set(
        segment.speakerId,
        (overlaps.get(segment.speakerId) ?? 0) + overlap,
      );
    }
  }
  const ranked = [...overlaps.entries()].sort(
    ([leftId, left], [rightId, right]) =>
      right - left || leftId.localeCompare(rightId),
  );
  if (ranked[0]) return ranked[0][0];

  const midpoint = (cue.startMs + cue.endMs) / 2;
  return [...segments].sort((left, right) => {
    const leftDistance = Math.min(
      Math.abs(midpoint - left.startMs),
      Math.abs(midpoint - left.endMs),
    );
    const rightDistance = Math.min(
      Math.abs(midpoint - right.startMs),
      Math.abs(midpoint - right.endMs),
    );
    return (
      leftDistance - rightDistance ||
      left.speakerId.localeCompare(right.speakerId)
    );
  })[0]!.speakerId;
}

export function addPostHocSpeakerAnalysis(
  cues: readonly SubtitleCueV1[],
  segments: readonly SubtitleSpeakerSegmentV1[],
): {
  readonly cues: readonly SubtitleCueV1[];
  readonly speakerAnalysis: SubtitleSpeakerAnalysisV1;
} {
  if (segments.length === 0) throw new Error('缺少说话人分析片段');
  return Object.freeze({
    cues: Object.freeze(
      cues.map((cue) =>
        Object.freeze({
          ...cue,
          speakerId: speakerForCue(cue, segments),
        }),
      ),
    ),
    speakerAnalysis: Object.freeze({
      method: 'post-hoc-diarization' as const,
      supportsOverlappingTranscription: false,
      segments: Object.freeze([...segments]),
    }),
  });
}

export function parseMossTranscriptionWorkerOutput(
  value: unknown,
): ParsedMossTranscriptionOutput {
  if (
    !isRecord(value) ||
    !Array.isArray(value.cues) ||
    value.cues.length === 0 ||
    !value.cues.every(isSubtitleCueV1) ||
    !Array.isArray(value.speakerSegments) ||
    value.speakerSegments.length === 0
  ) {
    throw new Error('MOSS 返回了无效字幕结果');
  }
  const cueIds = new Set<string>();
  const sourceCueIds = new Set<string>();
  let previousCueStartMs = -1;
  let previousCueEndMs = -1;
  for (const cue of value.cues) {
    if (
      cueIds.has(cue.id) ||
      cue.startMs < previousCueStartMs ||
      (cue.startMs === previousCueStartMs && cue.endMs < previousCueEndMs) ||
      cue.sourceCueIds.some((sourceCueId) => sourceCueIds.has(sourceCueId))
    ) {
      throw new Error('MOSS 返回了顺序或标识无效的字幕');
    }
    cueIds.add(cue.id);
    cue.sourceCueIds.forEach((sourceCueId) => sourceCueIds.add(sourceCueId));
    previousCueStartMs = cue.startMs;
    previousCueEndMs = cue.endMs;
  }
  const segments = value.speakerSegments.map((segment) => {
    if (
      !isRecord(segment) ||
      !isSubtitleSpeakerId(segment.speakerId) ||
      !Number.isSafeInteger(segment.startMs) ||
      !Number.isSafeInteger(segment.endMs) ||
      Number(segment.startMs) < 0 ||
      Number(segment.endMs) <= Number(segment.startMs)
    ) {
      throw new Error('MOSS 返回了无效说话人片段');
    }
    return Object.freeze({
      speakerId: segment.speakerId,
      startMs: Number(segment.startMs),
      endMs: Number(segment.endMs),
    });
  });
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1]!;
    const current = segments[index]!;
    if (
      current.startMs < previous.startMs ||
      (current.startMs === previous.startMs && current.endMs < previous.endMs)
    ) {
      throw new Error('MOSS 返回了顺序无效的说话人片段');
    }
  }
  const speakerIds = new Set(segments.map(({ speakerId }) => speakerId));
  if (
    value.cues.some(
      (cue) => cue.speakerId === undefined || !speakerIds.has(cue.speakerId),
    )
  ) {
    throw new Error('MOSS 字幕与说话人片段不一致');
  }
  return Object.freeze({
    language: normalizedSubtitleLanguage(value.language),
    cues: Object.freeze([...value.cues]),
    speakerAnalysis: Object.freeze({
      method: 'joint-transcription-diarization' as const,
      supportsOverlappingTranscription: true,
      segments: Object.freeze(segments),
    }),
  });
}
