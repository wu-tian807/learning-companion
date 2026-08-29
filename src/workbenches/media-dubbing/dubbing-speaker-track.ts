import type { JsonValue } from '../../shared/workbench/protocol';
import { cloneJsonValue } from '../../shared/workbench/protocol';
import type { DubbingCueSpeakerAssignment } from './dubbing-phrase-planner';
import type {
  DubbingSpeakerRoutingPlan,
  DubbingVoiceProfile,
} from './dubbing-speaker-planner';

export const DUBBING_SPEAKER_TRACK_VERSION = 1;
export const UNKNOWN_DUBBING_SPEAKER_TRACK_ID = 'speaker-unknown';

export type DubbingSpeakerCueStatus =
  | 'stable'
  | 'uncertain'
  | 'unknown';

export interface DubbingSpeakerTrackCueV1 {
  readonly sourceCueId: string;
  readonly speakerId: string;
  readonly status: DubbingSpeakerCueStatus;
}

export type DubbingSpeakerTrackProfileV1 =
  | {
      readonly speakerId: string;
      readonly mode: 'reference';
      readonly referenceStartMs: number;
      readonly referenceEndMs: number;
    }
  | {
      readonly speakerId: string;
      readonly mode: 'default';
    };

/**
 * Renderer-safe, translation-independent projection of the internal dubbing
 * plan. It is keyed to the source subtitle artifact and intentionally omits
 * translated phrases and local reference WAV paths.
 */
export interface DubbingSpeakerTrackV1 {
  readonly version: typeof DUBBING_SPEAKER_TRACK_VERSION;
  readonly kind: 'dubbing-speaker-track';
  readonly sourceTrackRevision: string;
  readonly cues: readonly DubbingSpeakerTrackCueV1[];
  readonly profiles: readonly DubbingSpeakerTrackProfileV1[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maximum = 256): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isDubbingSpeakerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^speaker-(?:\d{4}|unknown)$/u.test(value)
  );
}

function cueStatus(
  assignment: DubbingCueSpeakerAssignment,
): DubbingSpeakerCueStatus {
  if (assignment.speakerId === UNKNOWN_DUBBING_SPEAKER_TRACK_ID) {
    return 'unknown';
  }
  return assignment.referenceEligible ? 'stable' : 'uncertain';
}

function projectProfile(
  profile: DubbingVoiceProfile,
): DubbingSpeakerTrackProfileV1 {
  return profile.mode === 'reference'
    ? Object.freeze({
        speakerId: profile.speakerId,
        mode: 'reference' as const,
        referenceStartMs: profile.reference.startMs,
        referenceEndMs: profile.reference.endMs,
      })
    : Object.freeze({
        speakerId: profile.speakerId,
        mode: 'default' as const,
      });
}

export function createDubbingSpeakerTrack(
  sourceTrackRevision: string,
  plan: Pick<
    DubbingSpeakerRoutingPlan,
    'cueAssignments' | 'voiceProfiles'
  >,
): DubbingSpeakerTrackV1 {
  const projected: DubbingSpeakerTrackV1 = {
    version: DUBBING_SPEAKER_TRACK_VERSION,
    kind: 'dubbing-speaker-track',
    sourceTrackRevision,
    cues: Object.freeze(
      plan.cueAssignments.map((assignment) =>
        Object.freeze({
          sourceCueId: assignment.cueId,
          speakerId: assignment.speakerId,
          status: cueStatus(assignment),
        }),
      ),
    ),
    profiles: Object.freeze(plan.voiceProfiles.map(projectProfile)),
  };
  return parseDubbingSpeakerTrack(projected);
}

function parseCue(value: unknown): DubbingSpeakerTrackCueV1 {
  if (
    !isRecord(value) ||
    !isText(value.sourceCueId) ||
    !isDubbingSpeakerId(value.speakerId) ||
    (value.status !== 'stable' &&
      value.status !== 'uncertain' &&
      value.status !== 'unknown') ||
    (value.speakerId === UNKNOWN_DUBBING_SPEAKER_TRACK_ID) !==
      (value.status === 'unknown')
  ) {
    throw new Error('持久说话人字幕归属无效');
  }
  return Object.freeze({
    sourceCueId: value.sourceCueId,
    speakerId: value.speakerId,
    status: value.status,
  });
}

function parseProfile(value: unknown): DubbingSpeakerTrackProfileV1 {
  if (!isRecord(value) || !isDubbingSpeakerId(value.speakerId)) {
    throw new Error('持久说话人声色 profile 无效');
  }
  if (value.mode === 'default') {
    return Object.freeze({
      speakerId: value.speakerId,
      mode: 'default' as const,
    });
  }
  if (
    value.mode !== 'reference' ||
    value.speakerId === UNKNOWN_DUBBING_SPEAKER_TRACK_ID ||
    !isTime(value.referenceStartMs) ||
    !isTime(value.referenceEndMs) ||
    value.referenceEndMs <= value.referenceStartMs
  ) {
    throw new Error('持久说话人声色参考无效');
  }
  return Object.freeze({
    speakerId: value.speakerId,
    mode: 'reference' as const,
    referenceStartMs: value.referenceStartMs,
    referenceEndMs: value.referenceEndMs,
  });
}

export function parseDubbingSpeakerTrack(
  value: unknown,
): DubbingSpeakerTrackV1 {
  if (
    !isRecord(value) ||
    value.version !== DUBBING_SPEAKER_TRACK_VERSION ||
    value.kind !== 'dubbing-speaker-track' ||
    !isText(value.sourceTrackRevision) ||
    !Array.isArray(value.cues) ||
    value.cues.length === 0 ||
    !Array.isArray(value.profiles) ||
    value.profiles.length === 0
  ) {
    throw new Error('持久说话人轨道无效');
  }

  const cues = value.cues.map(parseCue);
  const profiles = value.profiles.map(parseProfile);
  const cueIds = new Set(cues.map((cue) => cue.sourceCueId));
  const profileIds = new Set(profiles.map((profile) => profile.speakerId));
  const cueSpeakerIds = new Set(cues.map((cue) => cue.speakerId));
  if (
    cueIds.size !== cues.length ||
    profileIds.size !== profiles.length ||
    [...cueSpeakerIds].some((speakerId) => !profileIds.has(speakerId)) ||
    [...profileIds].some((speakerId) => !cueSpeakerIds.has(speakerId))
  ) {
    throw new Error('持久说话人轨道身份不一致');
  }

  return Object.freeze({
    version: DUBBING_SPEAKER_TRACK_VERSION,
    kind: 'dubbing-speaker-track',
    sourceTrackRevision: value.sourceTrackRevision,
    cues: Object.freeze(cues),
    profiles: Object.freeze(profiles),
  });
}

export function isDubbingSpeakerTrack(
  value: unknown,
): value is DubbingSpeakerTrackV1 {
  try {
    parseDubbingSpeakerTrack(value);
    return true;
  } catch {
    return false;
  }
}

export function cloneDubbingSpeakerTrack(
  track: DubbingSpeakerTrackV1,
): JsonValue & DubbingSpeakerTrackV1 {
  const parsed = parseDubbingSpeakerTrack(track);
  return cloneJsonValue(parsed as unknown as JsonValue) as JsonValue &
    DubbingSpeakerTrackV1;
}
