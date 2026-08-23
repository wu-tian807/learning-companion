import { describe, expect, it } from 'vitest';

import {
  segmentSubtitleTokens,
  type TimestampedSubtitleToken,
} from './subtitle-cue-segmenter';

function tokens(
  source: readonly (readonly [string, number, number])[],
): readonly TimestampedSubtitleToken[] {
  return source.map(([text, startMs, endMs], index) => ({
    id: `raw-token-${index + 1}`,
    segmentId: 'raw-segment-1',
    startMs,
    endMs,
    text,
  }));
}

describe('segmentSubtitleTokens', () => {
  it('splits the reported 19-second Chinese segment at model-timed clauses', () => {
    const source = tokens([
      ['今天我们验证一条本地字幕生成链路，', 130, 3_430],
      ['视频播放不需要等待转录完成，', 3_790, 6_630],
      ['系统应该尽快给出第一条字幕，', 6_630, 9_820],
      ['并在后台继续处理后续内容，', 9_820, 13_240],
      ['最终结果会保存为可以重复使用的字幕文件。', 13_240, 17_140],
    ]);

    expect(segmentSubtitleTokens(source, 'zh-Hans')).toEqual([
      expect.objectContaining({
        startMs: 130,
        endMs: 3_430,
        text: '今天我们验证一条本地字幕生成链路，',
      }),
      expect.objectContaining({
        startMs: 3_790,
        endMs: 6_630,
        text: '视频播放不需要等待转录完成，',
      }),
      expect.objectContaining({
        startMs: 6_630,
        endMs: 9_820,
        text: '系统应该尽快给出第一条字幕，',
      }),
      expect.objectContaining({
        startMs: 9_820,
        endMs: 13_240,
        text: '并在后台继续处理后续内容，',
      }),
      expect.objectContaining({
        startMs: 13_240,
        endMs: 17_140,
        text: '最终结果会保存为可以重复使用的字幕文件。',
      }),
    ]);
  });

  it('uses real English word boundaries when punctuation is absent', () => {
    const source = tokens([
      ['Local ', 0, 700],
      ['subtitle ', 700, 1_500],
      ['generation ', 1_500, 2_400],
      ['continues ', 2_400, 3_300],
      ['while ', 3_300, 4_000],
      ['the ', 4_000, 4_400],
      ['video ', 4_400, 5_200],
      ['keeps ', 5_200, 5_900],
      ['playing', 5_900, 6_700],
    ]);

    const cues = segmentSubtitleTokens(source, 'en');

    expect(cues).toHaveLength(2);
    expect(cues[0].endMs).toBeLessThanOrEqual(6_000);
    expect(cues[1].startMs).toBe(cues[0].endMs);
    expect(cues.map(({ text }) => text).join(' ')).toBe(
      'Local subtitle generation continues while the video keeps playing',
    );
  });

  it('does not keep a cue open across a long measured silence', () => {
    const source = tokens([
      ['第一句', 0, 1_000],
      ['第二句', 1_900, 2_900],
    ]);

    expect(segmentSubtitleTokens(source, 'zh-Hans')).toEqual([
      expect.objectContaining({ startMs: 0, endMs: 1_000, text: '第一句' }),
      expect.objectContaining({ startMs: 1_900, endMs: 2_900, text: '第二句' }),
    ]);
  });

  it('adds a small display window around DTW alignment points without filling silence', () => {
    const alignedPhrase = (
      text: string,
      segmentId: string,
      startMs: number,
      endMs: number,
    ): readonly TimestampedSubtitleToken[] => [...text].map((character, index) => {
      const alignmentMs = Math.round(
        startMs + ((endMs - startMs) * index) / (text.length - 1),
      );
      return {
        id: `${segmentId}-${index}`,
        segmentId,
        startMs: alignmentMs,
        endMs: alignmentMs,
        text: character,
      };
    });
    const source = [
      ...alignedPhrase('今天我们验证字幕。', 'segment-1', 420, 3_520),
      ...alignedPhrase('视频继续播放。', 'segment-2', 4_700, 7_320),
    ];

    expect(segmentSubtitleTokens(source, 'zh-Hans')).toEqual([
      expect.objectContaining({
        startMs: 170,
        endMs: 3_720,
        text: '今天我们验证字幕。',
      }),
      expect.objectContaining({
        startMs: 4_450,
        endMs: 7_520,
        text: '视频继续播放。',
      }),
    ]);
  });

  it('rejects malformed and overlapping token boundaries instead of inventing time', () => {
    expect(() => segmentSubtitleTokens([
      {
        id: 'raw-1',
        segmentId: 'segment-1',
        startMs: 1_000,
        endMs: 2_000,
        text: '第一句，',
      },
      {
        id: 'raw-2',
        segmentId: 'segment-1',
        startMs: 900,
        endMs: 3_000,
        text: '第二句。',
      },
    ], 'zh-Hans')).toThrow('字幕 Token 时间轴无效');

    const overlapping = tokens([
      ['第一句，', 0, 2_000],
      ['第二句。', 1_900, 3_000],
    ]);
    expect(segmentSubtitleTokens(overlapping, 'zh-Hans')).toHaveLength(1);
  });
});
