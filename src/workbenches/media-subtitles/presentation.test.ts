import { describe, expect, it } from 'vitest';

import {
  applyMediaSubtitleCueFinal,
  isMediaSubtitleSnapshot,
  type MediaSubtitleSnapshot,
} from './presentation';

function sourceSnapshot(): MediaSubtitleSnapshot {
  return {
    phase: 'translating',
    source: {
      version: 1,
      kind: 'subtitle-source',
      sourceRevision: 'source-revision',
      language: 'en',
      origin: 'asr',
      engine: { id: 'asr', version: '1', model: 'model', backend: 'cpu' },
      generatedTime: 100,
      cues: [
        {
          id: 'cue-1',
          startMs: 0,
          endMs: 1_000,
          text: 'One.',
          sourceCueIds: ['raw-1'],
        },
        {
          id: 'cue-2',
          startMs: 1_000,
          endMs: 2_000,
          text: 'Two.',
          sourceCueIds: ['raw-2'],
        },
      ],
    },
    partialTranslations: [{ sourceCueId: 'cue-2', text: '二。' }],
    completedCues: 1,
    totalCues: 2,
  };
}

describe('media subtitle presentation protocol', () => {
  it('merges streamed cues in source order', () => {
    const updated = applyMediaSubtitleCueFinal(sourceSnapshot(), {
      sourceTrackRevision: 'source-revision',
      cue: { sourceCueId: 'cue-1', text: '一。' },
      completedCues: 2,
      totalCues: 2,
    });

    expect(updated.partialTranslations).toEqual([
      { sourceCueId: 'cue-1', text: '一。' },
      { sourceCueId: 'cue-2', text: '二。' },
    ]);
  });

  it('ignores a late cue from an obsolete source revision', () => {
    const current = sourceSnapshot();
    expect(
      applyMediaSubtitleCueFinal(current, {
        sourceTrackRevision: 'old-revision',
        cue: { sourceCueId: 'cue-1', text: '旧。' },
        completedCues: 2,
        totalCues: 2,
      }),
    ).toBe(current);
  });

  it('rejects impossible progress counts', () => {
    expect(
      isMediaSubtitleSnapshot({
        ...sourceSnapshot(),
        completedCues: 3,
        totalCues: 2,
      }),
    ).toBe(false);
  });

  it('accepts the actionable Provider configuration state', () => {
    expect(
      isMediaSubtitleSnapshot({
        ...sourceSnapshot(),
        phase: 'provider-required',
        message: '请配置低智能翻译连接。',
      }),
    ).toBe(true);
  });
});
