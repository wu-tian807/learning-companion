import { describe, expect, it } from 'vitest';

import {
  addPostHocSpeakerAnalysis,
  parseSenseVoiceStreamingTranscription,
  parseSenseVoiceTranscription,
  parseSherpaSpeakerDiarization,
  parseWhisperStreamingCues,
  parseWhisperTranscription,
} from './transcription-output-adapter';

describe('transcription output adapters', () => {
  it('restores readable Whisper cues from timestamped tokens', () => {
    const result = parseWhisperTranscription({
      result: { language: 'zh' },
      transcription: [
        {
          offsets: { from: 0, to: 8_000 },
          text: '第一句话很长，第二句话也很长，播放器不应该一次显示一整个段落。',
          tokens: [
            { offsets: { from: 0, to: 2_000 }, text: '第一句话很长，' },
            { offsets: { from: 2_000, to: 4_000 }, text: '第二句话也很长，' },
            {
              offsets: { from: 4_000, to: 8_000 },
              text: '播放器不应该一次显示一整个段落。',
            },
          ],
        },
      ],
    });

    expect(result.language).toBe('zh-Hans');
    expect(result.cues.length).toBeGreaterThan(1);
    expect(result.cues.at(-1)?.endMs).toBe(8_000);
  });

  it('extracts completed Whisper console segments incrementally and deduplicates them', () => {
    expect(
      parseWhisperStreamingCues(
        '[00:00:00.000 --> 00:00:01.200] 第一段。\n' +
          '[00:00:00.000 --> 00:00:01.200] 第一段。\n' +
          '[00:00:01.200 --> 00:00:02.500] 第二段。\n',
      ),
    ).toEqual([
      {
        id: 'partial-000001',
        startMs: 0,
        endMs: 1_200,
        text: '第一段。',
        sourceCueIds: ['partial-000001'],
      },
      {
        id: 'partial-000002',
        startMs: 1_200,
        endMs: 2_500,
        text: '第二段。',
        sourceCueIds: ['partial-000002'],
      },
    ]);
  });

  it('keeps SenseVoice VAD timing and recognized text aligned', () => {
    expect(
      parseSenseVoiceTranscription(
        '0 2000\n2000 4000\n',
        '<|zh|><|NEUTRAL|><|Speech|><|woitn|>第一句。' +
          '<|zh|><|NEUTRAL|><|Speech|><|woitn|>第二句。',
      ),
    ).toMatchObject({
      language: 'zh-Hans',
      cues: [
        { startMs: 0, endMs: 2_000, text: '第一句。' },
        { startMs: 2_000, endMs: 4_000, text: '第二句。' },
      ],
    });
  });

  it('exposes completed SenseVoice segments before the whole command finishes', () => {
    expect(
      parseSenseVoiceStreamingTranscription(
        '0 2000\n2000 4000\n',
        '<|zh|><|NEUTRAL|><|Speech|><|woitn|>第一句。',
      ),
    ).toMatchObject({
      language: 'zh-Hans',
      cues: [{ startMs: 0, endMs: 2_000, text: '第一句。' }],
    });
  });

  it('normalizes Sherpa speakers and attributes cues by dominant overlap', () => {
    const segments = parseSherpaSpeakerDiarization(
      '2.000 -- 4.000 speaker_09\n' +
        '0.000 -- 2.200 speaker_03\n' +
        '1.800 -- 2.500 speaker_09\n',
    );
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
      segments,
    );

    expect(segments).toEqual([
      { speakerId: 'speaker-0001', startMs: 0, endMs: 2_200 },
      { speakerId: 'speaker-0002', startMs: 1_800, endMs: 2_500 },
      { speakerId: 'speaker-0002', startMs: 2_000, endMs: 4_000 },
    ]);
    expect(result.cues.map(({ speakerId }) => speakerId)).toEqual([
      'speaker-0001',
      'speaker-0002',
    ]);
    expect(result.speakerAnalysis).toMatchObject({
      method: 'post-hoc-diarization',
      supportsOverlappingTranscription: false,
    });
  });

  it.each([
    () => parseWhisperTranscription({}),
    () => parseSenseVoiceTranscription('0 1000', ''),
    () => parseSherpaSpeakerDiarization('no speaker segments'),
  ])('rejects empty or malformed model output', (parse) => {
    expect(parse).toThrow();
  });
});
