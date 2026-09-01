import { describe, expect, it } from 'vitest';

import {
  addPostHocSpeakerAnalysis,
  parseMossTranscriptionWorkerOutput,
  parseSherpaSpeakerDiarization,
} from './transcription-output-adapter';

describe('speaker-aware transcription output adapters', () => {
  it('normalizes sherpa speaker labels by first chronological appearance', () => {
    expect(
      parseSherpaSpeakerDiarization(
        '2.000 -- 4.000 speaker_09\n' +
          '0.000 -- 2.200 speaker_03\n' +
          '1.800 -- 2.500 speaker_09\n',
      ),
    ).toEqual([
      { speakerId: 'speaker-0001', startMs: 0, endMs: 2_200 },
      { speakerId: 'speaker-0002', startMs: 1_800, endMs: 2_500 },
      { speakerId: 'speaker-0002', startMs: 2_000, endMs: 4_000 },
    ]);
  });

  it('uses dominant overlap for CPU cue attribution without claiming overlap transcription', () => {
    const result = addPostHocSpeakerAnalysis(
      [
        {
          id: 'cue-000001',
          startMs: 0,
          endMs: 2_000,
          text: 'one',
          sourceCueIds: ['cue-000001'],
        },
        {
          id: 'cue-000002',
          startMs: 2_000,
          endMs: 4_000,
          text: 'two',
          sourceCueIds: ['cue-000002'],
        },
      ],
      [
        { speakerId: 'speaker-0001', startMs: 0, endMs: 2_300 },
        { speakerId: 'speaker-0002', startMs: 1_700, endMs: 4_000 },
      ],
    );

    expect(result.cues.map(({ speakerId }) => speakerId)).toEqual([
      'speaker-0001',
      'speaker-0002',
    ]);
    expect(result.speakerAnalysis.supportsOverlappingTranscription).toBe(false);
  });

  it('accepts MOSS cues that overlap when each retains its own speaker', () => {
    const result = parseMossTranscriptionWorkerOutput({
      language: 'zh',
      cues: [
        {
          id: 'cue-000001',
          startMs: 0,
          endMs: 2_000,
          text: '甲在说话',
          sourceCueIds: ['cue-000001'],
          speakerId: 'speaker-0001',
        },
        {
          id: 'cue-000002',
          startMs: 1_000,
          endMs: 2_500,
          text: '乙也在说话',
          sourceCueIds: ['cue-000002'],
          speakerId: 'speaker-0002',
        },
      ],
      speakerSegments: [
        { speakerId: 'speaker-0001', startMs: 0, endMs: 2_000 },
        { speakerId: 'speaker-0002', startMs: 1_000, endMs: 2_500 },
      ],
    });

    expect(result.language).toBe('zh-Hans');
    expect(result.speakerAnalysis).toMatchObject({
      method: 'joint-transcription-diarization',
      supportsOverlappingTranscription: true,
    });
    expect(result.cues).toHaveLength(2);
  });
});
