import { describe, expect, it } from 'vitest';

import type {
  SubtitleCueV1,
  SubtitleTranslationTrackV1,
} from '../../media-subtitles/contracts';
import {
  createDubbingPhrases,
  normalizeChineseSpokenText,
  selectDubbingReferenceWindow,
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
      createDubbingPhrases(source, translation(source, ['第一句话。', '好'])),
    ).toHaveLength(2);
  });

  it('selects a 3-10 second reference using complete source cue boundaries', () => {
    const source = [
      cue('cue-1', 500, 2_700, 'A sufficiently long source sentence.'),
      cue('cue-2', 2_900, 6_600, 'Another sufficiently long source sentence.'),
      cue('cue-3', 8_000, 8_600, 'Short.'),
    ];

    expect(selectDubbingReferenceWindow(source)).toEqual({
      startMs: 500,
      endMs: 6_600,
      sourceCueIds: ['cue-1', 'cue-2'],
    });
  });

  it('rejects media without a usable one-shot reference', () => {
    expect(() =>
      selectDubbingReferenceWindow([
        cue('cue-1', 0, 500, 'Too short.'),
        cue('cue-2', 5_000, 5_300, 'Still short.'),
      ]),
    ).toThrow('找不到 3 至 10 秒的有效参考人声');
  });
});
