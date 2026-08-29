import type {
  SubtitleCueV1,
  SubtitleTranslationTrackV1,
} from '../media-subtitles/contracts';
import {
  createDubbingPhrases,
  type DubbingCueSpeakerAssignment,
  type DubbingPhrase,
} from './dubbing-phrase-planner';

const MINIMUM_REFERENCE_DURATION_MS = 3_000;
const MAXIMUM_REFERENCE_DURATION_MS = 10_000;
const TARGET_REFERENCE_DURATION_MS = 6_000;
const MAXIMUM_REFERENCE_GAP_MS = 700;
const MAXIMUM_REFERENCE_CUES = 4;
const MINIMUM_REFERENCE_TEXT_LENGTH = 20;
const MINIMUM_REFERENCE_SPEECH_MS = 2_500;
const MINIMUM_REFERENCE_SPEECH_RATIO = 0.5;
const MAXIMUM_REFERENCE_FOREIGN_SPEECH_MS = 200;
const MINIMUM_CUE_SPEAKER_COVERAGE = 0.6;
const MINIMUM_UNCERTAIN_SWITCH_MS = 250;
const MINIMUM_UNCERTAIN_SWITCH_RATIO = 0.1;

export const DUBBING_SPEAKER_PLANNER_VERSION = 1;
export const DUBBING_SPEAKER_PLAN_VERSION = 1;
export const UNKNOWN_DUBBING_SPEAKER_ID = 'speaker-unknown';

export interface DubbingSpeakerSegment {
  readonly speakerId: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface DubbingReferenceWindow {
  readonly startMs: number;
  readonly endMs: number;
  readonly sourceCueIds: readonly string[];
}

export type DubbingVoiceProfile =
  | {
      readonly speakerId: string;
      readonly mode: 'reference';
      readonly reference: DubbingReferenceWindow;
    }
  | {
      readonly speakerId: string;
      readonly mode: 'default';
    };

export interface DubbingSpeakerRoutingPlan {
  readonly version: typeof DUBBING_SPEAKER_PLAN_VERSION;
  readonly segments: readonly DubbingSpeakerSegment[];
  readonly cueAssignments: readonly DubbingCueSpeakerAssignment[];
  readonly voiceProfiles: readonly DubbingVoiceProfile[];
  readonly phrases: readonly DubbingPhrase[];
}

interface IndexedCue {
  readonly cue: SubtitleCueV1;
  readonly assignment: DubbingCueSpeakerAssignment;
  readonly index: number;
}

interface ReferenceCandidate extends DubbingReferenceWindow {
  readonly score: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function isSpeakerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^speaker-(?:\d{4}|unknown)$/u.test(value)
  );
}

function overlapMs(
  leftStartMs: number,
  leftEndMs: number,
  rightStartMs: number,
  rightEndMs: number,
): number {
  return Math.max(
    0,
    Math.min(leftEndMs, rightEndMs) - Math.max(leftStartMs, rightStartMs),
  );
}

function coveredDurationMs(
  segments: readonly DubbingSpeakerSegment[],
  startMs: number,
  endMs: number,
): number {
  const intervals = segments
    .map((segment) => ({
      startMs: Math.max(startMs, segment.startMs),
      endMs: Math.min(endMs, segment.endMs),
    }))
    .filter(({ startMs: start, endMs: end }) => end > start)
    .sort(
      (left, right) =>
        left.startMs - right.startMs || left.endMs - right.endMs,
    );
  let covered = 0;
  let currentStart: number | undefined;
  let currentEnd: number | undefined;
  for (const interval of intervals) {
    if (currentStart === undefined || currentEnd === undefined) {
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
      continue;
    }
    if (interval.startMs <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endMs);
      continue;
    }
    covered += currentEnd - currentStart;
    currentStart = interval.startMs;
    currentEnd = interval.endMs;
  }
  return currentStart === undefined || currentEnd === undefined
    ? covered
    : covered + currentEnd - currentStart;
}

export function parseDubbingSpeakerSegments(
  value: unknown,
  durationMs: number,
): readonly DubbingSpeakerSegment[] {
  if (!isSafeInteger(durationMs, 1) || !isRecord(value)) {
    throw new Error('说话人分析结果无效');
  }
  const rawSegments = value.segments;
  if (!Array.isArray(rawSegments)) {
    throw new Error('说话人分析结果缺少 segments');
  }

  const normalized = rawSegments.map((raw, index) => {
    if (
      !isRecord(raw) ||
      !isSafeInteger(raw.speaker) ||
      typeof raw.start !== 'number' ||
      !Number.isFinite(raw.start) ||
      typeof raw.end !== 'number' ||
      !Number.isFinite(raw.end) ||
      raw.start < 0 ||
      raw.end <= raw.start ||
      raw.end * 1_000 > durationMs + 5_000
    ) {
      throw new Error(`说话人分析片段 ${index + 1} 无效`);
    }
    return {
      rawSpeaker: raw.speaker,
      startMs: Math.max(0, Math.round(raw.start * 1_000)),
      endMs: Math.min(durationMs, Math.round(raw.end * 1_000)),
    };
  });
  normalized.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.rawSpeaker - right.rawSpeaker,
  );

  const speakerIds = new Map<number, string>();
  const segments: DubbingSpeakerSegment[] = [];
  for (const segment of normalized) {
    if (segment.endMs <= segment.startMs) continue;
    let speakerId = speakerIds.get(segment.rawSpeaker);
    if (!speakerId) {
      speakerId = `speaker-${String(speakerIds.size + 1).padStart(4, '0')}`;
      speakerIds.set(segment.rawSpeaker, speakerId);
    }
    segments.push(
      Object.freeze({
        speakerId,
        startMs: segment.startMs,
        endMs: segment.endMs,
      }),
    );
  }
  return Object.freeze(segments);
}

export function attributeDubbingCuesToSpeakers(
  cues: readonly SubtitleCueV1[],
  segments: readonly DubbingSpeakerSegment[],
): readonly DubbingCueSpeakerAssignment[] {
  return Object.freeze(
    cues.map((cue) => {
      const durationMs = cue.endMs - cue.startMs;
      const overlaps = new Map<string, number>();
      for (const segment of segments) {
        const overlap = overlapMs(
          cue.startMs,
          cue.endMs,
          segment.startMs,
          segment.endMs,
        );
        if (overlap > 0) {
          overlaps.set(
            segment.speakerId,
            (overlaps.get(segment.speakerId) ?? 0) + overlap,
          );
        }
      }
      const ranked = [...overlaps.entries()].sort(
        ([leftSpeaker, leftOverlap], [rightSpeaker, rightOverlap]) =>
          rightOverlap - leftOverlap || leftSpeaker.localeCompare(rightSpeaker),
      );
      const [dominantSpeaker, rawDominantOverlap] = ranked[0] ?? [
        UNKNOWN_DUBBING_SPEAKER_ID,
        0,
      ];
      const dominantOverlapMs = Math.min(durationMs, rawDominantOverlap);
      const otherSpeakerOverlapMs = Math.min(
        durationMs,
        ranked
          .slice(1)
          .reduce((total, [, overlap]) => total + overlap, 0),
      );
      const switchIsUncertain =
        otherSpeakerOverlapMs >= MINIMUM_UNCERTAIN_SWITCH_MS &&
        otherSpeakerOverlapMs / durationMs >=
          MINIMUM_UNCERTAIN_SWITCH_RATIO;
      return Object.freeze({
        cueId: cue.id,
        speakerId: dominantSpeaker,
        referenceEligible:
          dominantSpeaker !== UNKNOWN_DUBBING_SPEAKER_ID &&
          dominantOverlapMs / durationMs >= MINIMUM_CUE_SPEAKER_COVERAGE &&
          !switchIsUncertain,
        dominantOverlapMs,
        otherSpeakerOverlapMs,
      });
    }),
  );
}

function referenceCandidate(
  selected: readonly IndexedCue[],
  speakerId: string,
  segments: readonly DubbingSpeakerSegment[],
): ReferenceCandidate | undefined {
  const startMs = selected[0]!.cue.startMs;
  const endMs = selected.at(-1)!.cue.endMs;
  const durationMs = endMs - startMs;
  const textLength = selected.reduce(
    (total, { cue }) => total + cue.text.trim().length,
    0,
  );
  if (
    durationMs < MINIMUM_REFERENCE_DURATION_MS ||
    durationMs > MAXIMUM_REFERENCE_DURATION_MS ||
    textLength < MINIMUM_REFERENCE_TEXT_LENGTH
  ) {
    return undefined;
  }
  const speakerSpeechMs = coveredDurationMs(
    segments.filter((segment) => segment.speakerId === speakerId),
    startMs,
    endMs,
  );
  const foreignSpeechMs = coveredDurationMs(
    segments.filter((segment) => segment.speakerId !== speakerId),
    startMs,
    endMs,
  );
  if (
    speakerSpeechMs < MINIMUM_REFERENCE_SPEECH_MS ||
    speakerSpeechMs / durationMs < MINIMUM_REFERENCE_SPEECH_RATIO ||
    foreignSpeechMs > MAXIMUM_REFERENCE_FOREIGN_SPEECH_MS
  ) {
    return undefined;
  }
  return {
    startMs,
    endMs,
    sourceCueIds: selected.map(({ cue }) => cue.id),
    score:
      Math.abs(durationMs - TARGET_REFERENCE_DURATION_MS) +
      (durationMs - Math.min(durationMs, speakerSpeechMs)) / 2,
  };
}

function selectReferenceForSpeaker(
  indexedCues: readonly IndexedCue[],
  speakerId: string,
  segments: readonly DubbingSpeakerSegment[],
): DubbingReferenceWindow | undefined {
  const candidates: ReferenceCandidate[] = [];
  for (let start = 0; start < indexedCues.length; start += 1) {
    const first = indexedCues[start]!;
    if (
      first.assignment.speakerId !== speakerId ||
      !first.assignment.referenceEligible
    ) {
      continue;
    }
    const selected: IndexedCue[] = [];
    for (
      let end = start;
      end < Math.min(indexedCues.length, start + MAXIMUM_REFERENCE_CUES);
      end += 1
    ) {
      const current = indexedCues[end]!;
      const previous = selected.at(-1);
      if (
        current.assignment.speakerId !== speakerId ||
        !current.assignment.referenceEligible ||
        (previous !== undefined &&
          (current.index !== previous.index + 1 ||
            current.cue.startMs - previous.cue.endMs < 0 ||
            current.cue.startMs - previous.cue.endMs >
              MAXIMUM_REFERENCE_GAP_MS))
      ) {
        break;
      }
      selected.push(current);
      const candidate = referenceCandidate(selected, speakerId, segments);
      if (candidate) candidates.push(candidate);
    }
  }
  const selected = candidates.sort(
    (left, right) =>
      left.score - right.score || left.startMs - right.startMs,
  )[0];
  return selected
    ? Object.freeze({
        startMs: selected.startMs,
        endMs: selected.endMs,
        sourceCueIds: Object.freeze([...selected.sourceCueIds]),
      })
    : undefined;
}

export function createDubbingVoiceProfiles(
  cues: readonly SubtitleCueV1[],
  assignments: readonly DubbingCueSpeakerAssignment[],
  segments: readonly DubbingSpeakerSegment[],
): readonly DubbingVoiceProfile[] {
  const assignmentByCue = new Map(
    assignments.map((assignment) => [assignment.cueId, assignment]),
  );
  if (assignmentByCue.size !== assignments.length) {
    throw new Error('说话人归属包含重复字幕');
  }
  const indexedCues = cues.map((cue, index) => {
    const assignment = assignmentByCue.get(cue.id);
    if (!assignment) throw new Error(`字幕 ${cue.id} 缺少说话人归属`);
    return { cue, assignment, index };
  });
  const speakerIds = [
    ...new Set(indexedCues.map(({ assignment }) => assignment.speakerId)),
  ];
  return Object.freeze(
    speakerIds.map((speakerId): DubbingVoiceProfile => {
      const reference =
        speakerId === UNKNOWN_DUBBING_SPEAKER_ID
          ? undefined
          : selectReferenceForSpeaker(indexedCues, speakerId, segments);
      return reference
        ? Object.freeze({ speakerId, mode: 'reference', reference })
        : Object.freeze({ speakerId, mode: 'default' });
    }),
  );
}

export function createDubbingSpeakerRoutingPlan(
  cues: readonly SubtitleCueV1[],
  translation: SubtitleTranslationTrackV1,
  segments: readonly DubbingSpeakerSegment[],
): DubbingSpeakerRoutingPlan {
  const cueAssignments = attributeDubbingCuesToSpeakers(cues, segments);
  const phrases = createDubbingPhrases(cues, translation, cueAssignments);
  const voiceProfiles = createDubbingVoiceProfiles(
    cues,
    cueAssignments,
    segments,
  );
  return Object.freeze({
    version: DUBBING_SPEAKER_PLAN_VERSION,
    segments: Object.freeze([...segments]),
    cueAssignments,
    voiceProfiles,
    phrases,
  });
}

function parseReferenceWindow(value: unknown): DubbingReferenceWindow {
  if (
    !isRecord(value) ||
    !isSafeInteger(value.startMs) ||
    !isSafeInteger(value.endMs, Number(value.startMs) + 1) ||
    !Array.isArray(value.sourceCueIds) ||
    value.sourceCueIds.length === 0 ||
    !value.sourceCueIds.every(
      (cueId) => typeof cueId === 'string' && cueId.length > 0,
    )
  ) {
    throw new Error('说话人参考窗口无效');
  }
  return Object.freeze({
    startMs: value.startMs,
    endMs: value.endMs,
    sourceCueIds: Object.freeze([...value.sourceCueIds]),
  });
}

function parseStoredPhrase(value: unknown): DubbingPhrase {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^phrase-\d{6}$/u.test(value.id) ||
    !isSpeakerId(value.speakerId) ||
    !isSafeInteger(value.startMs) ||
    !isSafeInteger(value.endMs, Number(value.startMs) + 1) ||
    typeof value.text !== 'string' ||
    value.text.trim().length === 0 ||
    typeof value.spokenText !== 'string' ||
    value.spokenText.trim().length === 0 ||
    typeof value.sourceText !== 'string' ||
    value.sourceText.trim().length === 0 ||
    !Array.isArray(value.sourceCueIds) ||
    value.sourceCueIds.length === 0 ||
    !value.sourceCueIds.every(
      (cueId) => typeof cueId === 'string' && cueId.length > 0,
    )
  ) {
    throw new Error('持久配音 phrase 无效');
  }
  return Object.freeze({
    id: value.id,
    speakerId: value.speakerId,
    startMs: value.startMs,
    endMs: value.endMs,
    text: value.text,
    spokenText: value.spokenText,
    sourceText: value.sourceText,
    sourceCueIds: Object.freeze([...value.sourceCueIds]),
  });
}

export function parseDubbingSpeakerRoutingPlan(
  value: unknown,
): DubbingSpeakerRoutingPlan {
  if (
    !isRecord(value) ||
    value.version !== DUBBING_SPEAKER_PLAN_VERSION ||
    !Array.isArray(value.segments) ||
    !Array.isArray(value.cueAssignments) ||
    !Array.isArray(value.voiceProfiles) ||
    !Array.isArray(value.phrases) ||
    value.phrases.length === 0
  ) {
    throw new Error('持久说话人计划无效');
  }

  const segments = value.segments.map((segment) => {
    if (
      !isRecord(segment) ||
      !isSpeakerId(segment.speakerId) ||
      segment.speakerId === UNKNOWN_DUBBING_SPEAKER_ID ||
      !isSafeInteger(segment.startMs) ||
      !isSafeInteger(segment.endMs, Number(segment.startMs) + 1)
    ) {
      throw new Error('持久说话人片段无效');
    }
    return Object.freeze({
      speakerId: segment.speakerId,
      startMs: segment.startMs,
      endMs: segment.endMs,
    });
  });
  const cueAssignments = value.cueAssignments.map((assignment) => {
    if (
      !isRecord(assignment) ||
      typeof assignment.cueId !== 'string' ||
      assignment.cueId.length === 0 ||
      !isSpeakerId(assignment.speakerId) ||
      typeof assignment.referenceEligible !== 'boolean' ||
      !isSafeInteger(assignment.dominantOverlapMs) ||
      !isSafeInteger(assignment.otherSpeakerOverlapMs)
    ) {
      throw new Error('持久字幕说话人归属无效');
    }
    return Object.freeze({
      cueId: assignment.cueId,
      speakerId: assignment.speakerId,
      referenceEligible: assignment.referenceEligible,
      dominantOverlapMs: assignment.dominantOverlapMs,
      otherSpeakerOverlapMs: assignment.otherSpeakerOverlapMs,
    });
  });
  const voiceProfiles = value.voiceProfiles.map((profile) => {
    if (!isRecord(profile) || !isSpeakerId(profile.speakerId)) {
      throw new Error('持久声色 profile 无效');
    }
    if (profile.mode === 'default') {
      return Object.freeze({
        speakerId: profile.speakerId,
        mode: 'default' as const,
      });
    }
    if (profile.mode !== 'reference') {
      throw new Error('持久声色 profile 模式无效');
    }
    return Object.freeze({
      speakerId: profile.speakerId,
      mode: 'reference' as const,
      reference: parseReferenceWindow(profile.reference),
    });
  });
  const phrases = value.phrases.map(parseStoredPhrase);
  const assignmentByCue = new Map(
    cueAssignments.map((assignment) => [assignment.cueId, assignment]),
  );
  const profileSpeakers = new Set(
    voiceProfiles.map((profile) => profile.speakerId),
  );
  if (
    assignmentByCue.size !== cueAssignments.length ||
    profileSpeakers.size !== voiceProfiles.length ||
    voiceProfiles.some(
      (profile) =>
        profile.mode === 'reference' &&
        profile.reference.sourceCueIds.some((cueId) => {
          const assignment = assignmentByCue.get(cueId);
          return (
            assignment?.speakerId !== profile.speakerId ||
            !assignment.referenceEligible
          );
        }),
    ) ||
    phrases.some(
      (phrase) =>
        !profileSpeakers.has(phrase.speakerId) ||
        phrase.sourceCueIds.some(
          (cueId) =>
            assignmentByCue.get(cueId)?.speakerId !== phrase.speakerId,
        ),
    )
  ) {
    throw new Error('持久说话人计划身份不一致');
  }

  return Object.freeze({
    version: DUBBING_SPEAKER_PLAN_VERSION,
    segments: Object.freeze(segments),
    cueAssignments: Object.freeze(cueAssignments),
    voiceProfiles: Object.freeze(voiceProfiles),
    phrases: Object.freeze(phrases),
  });
}
