import { describe, expect, it } from 'vitest';

import type { SubtitleLanguage } from './contracts';
import { segmentSubtitleTokens } from './subtitle-cue-segmenter';

type TokenTuple = readonly [text: string, startMs: number, endMs: number];

function segment(
  source: readonly TokenTuple[],
  language: SubtitleLanguage = 'zh-Hans',
) {
  return segmentSubtitleTokens(
    source.map(([text, startMs, endMs], index) => ({
      id: `raw-${index}`,
      segmentId: 'segment',
      startMs,
      endMs,
      text,
    })),
    language,
  );
}

describe('segmentSubtitleTokens', () => {
  it('splits a long Chinese result at model-timed clauses', () => {
    const source = [
      ['今天我们验证一条本地字幕生成链路，', 130, 3_430],
      ['视频播放不需要等待转录完成，', 3_790, 6_630],
      ['系统应该尽快给出第一条字幕，', 6_630, 9_820],
      ['并在后台继续处理后续内容，', 9_820, 13_240],
      ['最终结果会保存为可以重复使用的字幕文件。', 13_240, 17_140],
    ] as const;
    const cues = segment(source);

    expect(cues.map(({ startMs, endMs }) => [startMs, endMs])).toEqual(
      source.map(([, startMs, endMs]) => [startMs, endMs]),
    );
    expect(cues.map(({ text }) => text).join('')).toContain(
      '视频播放不需要等待转录完成',
    );
  });

  it('honors duration, word boundaries and measured silence', () => {
    const english = segment(
      'Local subtitle generation continues while the video keeps playing'
        .split(' ')
        .map(
          (word, index) =>
            [`${word} `, index * 750, (index + 1) * 750] as const,
        ),
      'en',
    );
    expect(english).toHaveLength(2);
    expect(english[0]!.endMs).toBeLessThanOrEqual(6_000);
    expect(english[1]!.startMs).toBe(english[0]!.endMs);
    expect(english.map(({ text }) => text).join(' ')).toBe(
      'Local subtitle generation continues while the video keeps playing',
    );
    expect(
      segment([
        ['第一句', 0, 1_000],
        ['第二句', 1_900, 2_900],
      ]),
    ).toHaveLength(2);
  });

  it('adds display windows around DTW points without filling silence', () => {
    const phrase = (text: string, segmentId: string, start: number, end: number) =>
      [...text].map((character, index) => {
        const point = Math.round(
          start + ((end - start) * index) / (text.length - 1),
        );
        return {
          id: `${segmentId}-${index}`,
          segmentId,
          startMs: point,
          endMs: point,
          text: character,
        };
      });
    const cues = segmentSubtitleTokens(
      [
        ...phrase('今天我们验证字幕。', 'one', 420, 3_520),
        ...phrase('视频继续播放。', 'two', 4_700, 7_320),
      ],
      'zh-Hans',
    );
    expect(cues.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [170, 3_720],
      [4_450, 7_520],
    ]);
  });

  it('rejects a reversed token timeline but preserves measured overlap', () => {
    expect(() =>
      segment(
        [
          ['第一句，', 1_000, 2_000],
          ['第二句。', 900, 3_000],
        ],
      ),
    ).toThrow('字幕 Token 时间轴无效');
    expect(
      segment([
        ['第一句，', 0, 2_000],
        ['第二句。', 1_900, 3_000],
      ]),
    ).toHaveLength(1);
  });
});
