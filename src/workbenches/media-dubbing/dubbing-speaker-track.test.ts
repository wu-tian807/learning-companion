import { describe, expect, it } from 'vitest';

import {
  cloneDubbingSpeakerTrack,
  createDubbingSpeakerTrack,
  isDubbingSpeakerTrack,
  parseDubbingSpeakerTrack,
} from './dubbing-speaker-track';

function track() {
  return createDubbingSpeakerTrack('source-track-revision', {
    cueAssignments: [
      {
        cueId: 'cue-1',
        speakerId: 'speaker-0001',
        referenceEligible: true,
        dominantOverlapMs: 3_000,
        otherSpeakerOverlapMs: 0,
      },
      {
        cueId: 'cue-2',
        speakerId: 'speaker-0001',
        referenceEligible: false,
        dominantOverlapMs: 1_800,
        otherSpeakerOverlapMs: 400,
      },
      {
        cueId: 'cue-3',
        speakerId: 'speaker-unknown',
        referenceEligible: false,
        dominantOverlapMs: 0,
        otherSpeakerOverlapMs: 0,
      },
    ],
    voiceProfiles: [
      {
        speakerId: 'speaker-0001',
        mode: 'reference',
        reference: {
          startMs: 0,
          endMs: 6_000,
          sourceCueIds: ['cue-1'],
        },
      },
      { speakerId: 'speaker-unknown', mode: 'default' },
    ],
  });
}

describe('dubbing speaker track contract', () => {
  it('projects cue certainty and stable voice references without phrases or paths', () => {
    expect(track()).toEqual({
      version: 1,
      kind: 'dubbing-speaker-track',
      sourceTrackRevision: 'source-track-revision',
      cues: [
        {
          sourceCueId: 'cue-1',
          speakerId: 'speaker-0001',
          status: 'stable',
        },
        {
          sourceCueId: 'cue-2',
          speakerId: 'speaker-0001',
          status: 'uncertain',
        },
        {
          sourceCueId: 'cue-3',
          speakerId: 'speaker-unknown',
          status: 'unknown',
        },
      ],
      profiles: [
        {
          speakerId: 'speaker-0001',
          mode: 'reference',
          referenceStartMs: 0,
          referenceEndMs: 6_000,
        },
        { speakerId: 'speaker-unknown', mode: 'default' },
      ],
    });
    expect(isDubbingSpeakerTrack(track())).toBe(true);
    expect(cloneDubbingSpeakerTrack(track())).toEqual(track());
  });

  it('rejects unknown versions, duplicate cues and profiles without matching cues', () => {
    const value = track();
    expect(
      isDubbingSpeakerTrack({ ...value, version: 2 }),
    ).toBe(false);
    expect(() =>
      parseDubbingSpeakerTrack({
        ...value,
        cues: [value.cues[0], value.cues[0]],
      }),
    ).toThrow('身份不一致');
    expect(() =>
      parseDubbingSpeakerTrack({
        ...value,
        profiles: [
          ...value.profiles,
          { speakerId: 'speaker-0002', mode: 'default' },
        ],
      }),
    ).toThrow('身份不一致');
  });

  it('rejects an unknown speaker with a reference and mismatched unknown status', () => {
    const value = track();
    expect(
      isDubbingSpeakerTrack({
        ...value,
        profiles: [
          value.profiles[0],
          {
            speakerId: 'speaker-unknown',
            mode: 'reference',
            referenceStartMs: 0,
            referenceEndMs: 4_000,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isDubbingSpeakerTrack({
        ...value,
        cues: [
          { ...value.cues[0], status: 'unknown' },
          ...value.cues.slice(1),
        ],
      }),
    ).toBe(false);
  });
});
