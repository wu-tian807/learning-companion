import { describe, expect, it } from 'vitest';

import type { SubtitleLanguage } from './contracts';
import {
  repairZeroDurationSubtitleCues,
  segmentSubtitleTokens,
} from './subtitle-cue-segmenter';

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
  it('does not emit a zero-duration cue for the reported Minecraft timeline', () => {
    const cues = segment([
      ['正常句子。', 674_750, 678_820],
      ['so', 679_840, 679_840],
      ['正常句子。', 680_870, 682_720],
    ]);

    expect(cues).toHaveLength(3);
    expect(cues.map(({ text }) => text)).toEqual([
      '正常句子。',
      'so',
      '正常句子。',
    ]);
    expect(cues.every(({ endMs, startMs }) => endMs > startMs)).toBe(true);
    expect(cues[1]).toMatchObject({ startMs: 679_590, endMs: 680_040 });
  });

  it('repairs zero-duration cues across the reported boundary cases', () => {
    const cases: readonly (readonly TokenTuple[])[] = [
      [
        ['第一句。', 1_000, 2_000],
        ['so', 2_500, 2_500],
        ['第二句。', 3_000, 4_000],
      ],
      [
        ['第一句。', 1_000, 2_000],
        ['so。', 2_500, 2_500],
        ['第二句。', 3_000, 4_000],
      ],
      [
        ['a', 2_000, 2_000],
        ['b', 2_000, 2_000],
        ['c', 2_000, 2_000],
      ],
      [
        ['so', 0, 0],
        ['第一句。', 1_000, 2_000],
      ],
      [
        ['第一句。', 1_000, 2_000],
        ['so', 3_000, 3_000],
      ],
      [
        ['第一句。', 1_000, 2_000],
        ['so', 2_000, 2_000],
        ['第二句。', 2_000, 3_000],
      ],
    ];
    for (const source of cases) {
      const cues = segment(source);
      expect(cues.every(({ endMs, startMs }) => endMs > startMs)).toBe(true);
    }
  });

  it('repairs only zero-duration cues and preserves valid timings and identity', () => {
    const cues = [
      {
        id: 'cue-1',
        startMs: 1_000,
        endMs: 2_000,
        text: '第一句。',
        sourceCueIds: ['raw-1'],
      },
      {
        id: 'cue-2',
        startMs: 2_500,
        endMs: 2_500,
        text: 'so',
        sourceCueIds: ['raw-2'],
      },
      {
        id: 'cue-3',
        startMs: 3_000,
        endMs: 4_000,
        text: '第二句。',
        sourceCueIds: ['raw-3'],
      },
    ] as const;
    const repaired = repairZeroDurationSubtitleCues(cues);

    expect(repaired[0]).toBe(cues[0]);
    expect(repaired[2]).toBe(cues[2]);
    expect(repaired[1]).toMatchObject({
      id: 'cue-2',
      sourceCueIds: ['raw-2'],
      startMs: 2_250,
      endMs: 2_700,
    });
  });

  it('uses an overlapping readable window when adjacent cues leave no gap', () => {
    const repaired = repairZeroDurationSubtitleCues([
      {
        id: 'cue-1',
        startMs: 1_000,
        endMs: 2_000,
        text: '第一句。',
        sourceCueIds: ['raw-1'],
      },
      {
        id: 'cue-2',
        startMs: 2_000,
        endMs: 2_000,
        text: 'so',
        sourceCueIds: ['raw-2'],
      },
      {
        id: 'cue-3',
        startMs: 2_000,
        endMs: 3_000,
        text: '第二句。',
        sourceCueIds: ['raw-3'],
      },
    ]);

    expect(repaired[1]).toMatchObject({ startMs: 1_750, endMs: 2_200 });
    expect(repaired.every(({ endMs, startMs }) => endMs > startMs)).toBe(true);
  });

  it('repairs point-aligned output and respects speaker boundaries and overlap', () => {
    const repaired = repairZeroDurationSubtitleCues(
      [
        {
          id: 'cue-1',
          startMs: 2_000,
          endMs: 2_000,
          text: '甲',
          sourceCueIds: ['raw-1'],
          speakerId: 'speaker-0001',
        },
        {
          id: 'cue-2',
          startMs: 2_000,
          endMs: 2_400,
          text: '乙',
          sourceCueIds: ['raw-2'],
          speakerId: 'speaker-0002',
        },
      ],
      {
        speakerAnalysis: {
          method: 'joint-transcription-diarization',
          supportsOverlappingTranscription: true,
          segments: [
            { speakerId: 'speaker-0001', startMs: 1_800, endMs: 2_600 },
            { speakerId: 'speaker-0002', startMs: 2_000, endMs: 2_400 },
          ],
        },
      },
    );

    expect(repaired[0]).toMatchObject({ startMs: 1_800, endMs: 2_000 });
    expect(repaired[1]).toMatchObject({ startMs: 2_000, endMs: 2_400 });
  });

  it('rejects a zero-duration cue outside its speaker segment', () => {
    expect(() =>
      repairZeroDurationSubtitleCues(
        [
          {
            id: 'cue-1',
            startMs: 3_000,
            endMs: 3_000,
            text: 'so',
            sourceCueIds: ['raw-1'],
            speakerId: 'speaker-0001',
          },
        ],
        {
          speakerAnalysis: {
            method: 'post-hoc-diarization',
            supportsOverlappingTranscription: false,
            segments: [
              { speakerId: 'speaker-0001', startMs: 1_000, endMs: 2_000 },
            ],
          },
        },
      ),
    ).toThrow('speaker-0001');
  });

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
