import { describe, expect, it } from 'vitest';

import type {
  SubtitleCueV1,
  SubtitleTranslationTrackV1,
} from '../media-subtitles/contracts';
import {
  UNKNOWN_DUBBING_SPEAKER_ID,
  attributeDubbingCuesToSpeakers,
  createDubbingSpeakerRoutingPlan,
  parseDubbingSpeakerRoutingPlan,
  type DubbingSpeakerSegment,
} from './dubbing-speaker-planner';

function cue(
  id: string,
  startMs: number,
  endMs: number,
  text: string,
): SubtitleCueV1 {
  return { id, startMs, endMs, text, sourceCueIds: [`raw-${id}`] };
}

function translation(
  sourceCues: readonly SubtitleCueV1[],
): SubtitleTranslationTrackV1 {
  return {
    version: 1,
    kind: 'subtitle-translation',
    sourceTrackRevision: 'source-revision',
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
    profile: 'quality',
    engine: {
      id: 'codex',
      version: '1',
      model: 'gpt-5.6-sol',
      backend: 'agent',
    },
    generatedTime: 100,
    cues: sourceCues.map((sourceCue, index) => ({
      sourceCueId: sourceCue.id,
      text: `这是第${index + 1}段需要生成的配音内容。`,
    })),
  };
}

describe('dubbing speaker planner', () => {
  it('routes by maximum overlap but excludes an in-cue switch from references', () => {
    const source = [
      cue('dominant', 3_000, 5_000, 'A boundary crosses this cue.'),
      cue('silent', 6_000, 7_000, 'No diarized speech.'),
    ];
    const segments: readonly DubbingSpeakerSegment[] = [
      { speakerId: 'speaker-0001', startMs: 3_000, endMs: 4_200 },
      { speakerId: 'speaker-0002', startMs: 4_200, endMs: 5_000 },
    ];

    expect(attributeDubbingCuesToSpeakers(source, segments)).toEqual([
      {
        cueId: 'dominant',
        speakerId: 'speaker-0001',
        referenceEligible: false,
        dominantOverlapMs: 1_200,
        otherSpeakerOverlapMs: 800,
      },
      {
        cueId: 'silent',
        speakerId: UNKNOWN_DUBBING_SPEAKER_ID,
        referenceEligible: false,
        dominantOverlapMs: 0,
        otherSpeakerOverlapMs: 0,
      },
    ]);
  });

  it('creates one stable reference per speaker and keeps phrase boundaries', () => {
    const source = [
      cue('speaker-a-1', 0, 3_500, 'A long clean sentence from speaker A.'),
      cue('speaker-a-2', 3_700, 6_500, 'Another clean sentence from speaker A.'),
      cue('speaker-b', 8_000, 11_000, 'A long clean sentence from speaker B.'),
    ];
    const segments: readonly DubbingSpeakerSegment[] = [
      { speakerId: 'speaker-0001', startMs: 0, endMs: 6_500 },
      { speakerId: 'speaker-0002', startMs: 8_000, endMs: 11_000 },
    ];

    const plan = createDubbingSpeakerRoutingPlan(
      source,
      translation(source),
      segments,
    );

    expect(plan.voiceProfiles).toEqual([
      {
        speakerId: 'speaker-0001',
        mode: 'reference',
        reference: {
          startMs: 0,
          endMs: 6_500,
          sourceCueIds: ['speaker-a-1', 'speaker-a-2'],
        },
      },
      {
        speakerId: 'speaker-0002',
        mode: 'reference',
        reference: {
          startMs: 8_000,
          endMs: 11_000,
          sourceCueIds: ['speaker-b'],
        },
      },
    ]);
    expect(plan.phrases.map(({ speakerId }) => speakerId)).toEqual([
      'speaker-0001',
      'speaker-0001',
      'speaker-0002',
    ]);
    expect(parseDubbingSpeakerRoutingPlan(JSON.parse(JSON.stringify(plan))))
      .toEqual(plan);

    const crossedReference = JSON.parse(JSON.stringify(plan)) as {
      voiceProfiles: { reference?: { sourceCueIds: string[] } }[];
    };
    crossedReference.voiceProfiles[0]!.reference!.sourceCueIds = ['speaker-b'];
    expect(() => parseDubbingSpeakerRoutingPlan(crossedReference)).toThrow(
      '持久说话人计划身份不一致',
    );
  });

  it('uses an explicit default profile when a speaker has no stable reference', () => {
    const source = [
      cue('speaker-a', 0, 3_500, 'A sufficiently long clean sentence.'),
      cue('speaker-b', 5_000, 5_700, 'Brief response.'),
    ];
    const segments: readonly DubbingSpeakerSegment[] = [
      { speakerId: 'speaker-0001', startMs: 0, endMs: 3_500 },
      { speakerId: 'speaker-0002', startMs: 5_000, endMs: 5_700 },
    ];

    const plan = createDubbingSpeakerRoutingPlan(
      source,
      translation(source),
      segments,
    );

    expect(plan.voiceProfiles).toContainEqual({
      speakerId: 'speaker-0002',
      mode: 'default',
    });
    expect(plan.voiceProfiles).not.toContainEqual(
      expect.objectContaining({
        speakerId: 'speaker-0002',
        reference: expect.anything(),
      }),
    );
  });

  it('falls back to one unknown default profile when diarization finds no speech', () => {
    const source = [
      cue('silent', 0, 3_500, 'A subtitle without a diarized speech segment.'),
    ];

    const plan = createDubbingSpeakerRoutingPlan(
      source,
      translation(source),
      [],
    );

    expect(plan.cueAssignments).toEqual([
      {
        cueId: 'silent',
        speakerId: UNKNOWN_DUBBING_SPEAKER_ID,
        referenceEligible: false,
        dominantOverlapMs: 0,
        otherSpeakerOverlapMs: 0,
      },
    ]);
    expect(plan.voiceProfiles).toEqual([
      {
        speakerId: UNKNOWN_DUBBING_SPEAKER_ID,
        mode: 'default',
      },
    ]);
    expect(plan.phrases[0]?.speakerId).toBe(
      UNKNOWN_DUBBING_SPEAKER_ID,
    );
  });

  it('rejects unknown persisted plan versions', () => {
    const source = [
      cue('speaker-a', 0, 3_500, 'A sufficiently long clean sentence.'),
    ];
    const plan = createDubbingSpeakerRoutingPlan(
      source,
      translation(source),
      [{ speakerId: 'speaker-0001', startMs: 0, endMs: 3_500 }],
    );
    const unknownVersion = {
      ...JSON.parse(JSON.stringify(plan)),
      version: 999,
    };

    expect(() => parseDubbingSpeakerRoutingPlan(unknownVersion)).toThrow(
      '持久说话人计划无效',
    );
  });

  it('does not select a reference window polluted between cues by another speaker', () => {
    const source = [
      cue('speaker-a-1', 0, 3_000, 'A long clean sentence from speaker A.'),
      cue('speaker-a-2', 3_600, 6_600, 'Another clean sentence from speaker A.'),
    ];
    const segments: readonly DubbingSpeakerSegment[] = [
      { speakerId: 'speaker-0001', startMs: 0, endMs: 3_000 },
      { speakerId: 'speaker-0002', startMs: 3_200, endMs: 3_500 },
      { speakerId: 'speaker-0001', startMs: 3_600, endMs: 6_600 },
    ];

    const plan = createDubbingSpeakerRoutingPlan(
      source,
      translation(source),
      segments,
    );

    expect(plan.voiceProfiles).toContainEqual({
      speakerId: 'speaker-0001',
      mode: 'reference',
      reference: {
        startMs: 0,
        endMs: 3_000,
        sourceCueIds: ['speaker-a-1'],
      },
    });
  });

  it.each([
    [200, 'reference'],
    [201, 'default'],
  ] as const)(
    'routes a reference with %d ms of foreign overlap as %s',
    (foreignSpeechMs, expectedMode) => {
      const source = [
        cue('speaker-a', 0, 3_500, 'A sufficiently long reference sentence.'),
      ];
      const plan = createDubbingSpeakerRoutingPlan(
        source,
        translation(source),
        [
          { speakerId: 'speaker-0001', startMs: 0, endMs: 3_500 },
          {
            speakerId: 'speaker-0002',
            startMs: 1_000,
            endMs: 1_000 + foreignSpeechMs,
          },
        ],
      );

      expect(plan.voiceProfiles[0]?.mode).toBe(expectedMode);
    },
  );
});
