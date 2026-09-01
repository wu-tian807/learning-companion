import { describe, expect, it } from 'vitest';

import type {
  SubtitleCueV1,
  SubtitleTranslationTrackV1,
} from '../media-subtitles/contracts';
import {
  createDubbingPhrases,
  normalizeChineseSpokenText,
  type DubbingCueSpeakerAssignment,
} from './dubbing-phrase-planner';

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
  texts: readonly string[],
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
      text: texts[index]!,
    })),
  };
}

function speakers(
  sourceCues: readonly SubtitleCueV1[],
  speakerIds: readonly string[] = sourceCues.map(() => 'speaker-0001'),
): readonly DubbingCueSpeakerAssignment[] {
  return sourceCues.map((sourceCue, index) => ({
    cueId: sourceCue.id,
    speakerId: speakerIds[index]!,
    referenceEligible: true,
    dominantOverlapMs: sourceCue.endMs - sourceCue.startMs,
    otherSpeakerOverlapMs: 0,
  }));
}

describe('dubbing phrase planner', () => {
  it('normalizes numbers only for Chinese speech synthesis', () => {
    expect(normalizeChineseSpokenText('2026年增长12.5%，09:05编号007。')).toBe(
      '二零二六年增长百分之十二点五，九点零五分编号零零七。',
    );
  });

  it('merges short adjacent translations without inventing timestamps', () => {
    const source = [
      cue('unsafe:/cue-1', 1_000, 3_000, 'This is the first sentence.'),
      cue('cue-2', 3_300, 3_800, 'Okay.'),
      cue('cue-3', 5_000, 7_000, 'This remains separate.'),
    ];

    const phrases = createDubbingPhrases(
      source,
      translation(source, ['这是第一句话。', '好啊', '这一句保持独立。']),
      speakers(source),
    );

    expect(phrases).toHaveLength(2);
    expect(phrases[0]).toMatchObject({
      id: 'phrase-000001',
      startMs: 1_000,
      endMs: 3_800,
      sourceCueIds: ['unsafe:/cue-1', 'cue-2'],
    });
    expect(phrases[1]).toMatchObject({
      id: 'phrase-000003',
      startMs: 5_000,
      endMs: 7_000,
    });
  });

  it('keeps a short cue separate when the real gap is too large', () => {
    const source = [
      cue('cue-1', 0, 2_000, 'First.'),
      cue('cue-2', 3_000, 3_500, 'Yes.'),
    ];

    expect(
      createDubbingPhrases(
        source,
        translation(source, ['第一句话。', '好']),
        speakers(source),
      ),
    ).toHaveLength(2);
  });

  it('never merges adjacent cues from different speakers', () => {
    const source = [
      cue('cue-1', 0, 2_000, 'First.'),
      cue('cue-2', 2_100, 2_500, 'Yes.'),
    ];

    expect(
      createDubbingPhrases(
        source,
        translation(source, ['第一句话。', '好']),
        speakers(source, ['speaker-0001', 'speaker-0002']),
      ),
    ).toEqual([
      expect.objectContaining({ speakerId: 'speaker-0001' }),
      expect.objectContaining({ speakerId: 'speaker-0002' }),
    ]);
  });

  it('keeps overlapping speakers as separate phrases on the same timeline', () => {
    const source = [
      cue('cue-1', 1_000, 4_000, 'First speaker.'),
      cue('cue-2', 2_500, 3_500, 'Second speaker.'),
    ];

    expect(
      createDubbingPhrases(
        source,
        translation(source, ['第一位说话人。', '第二位说话人。']),
        speakers(source, ['speaker-0001', 'speaker-0002']),
      ),
    ).toEqual([
      expect.objectContaining({
        speakerId: 'speaker-0001',
        startMs: 1_000,
        endMs: 4_000,
      }),
      expect.objectContaining({
        speakerId: 'speaker-0002',
        startMs: 2_500,
        endMs: 3_500,
      }),
    ]);
  });

});
