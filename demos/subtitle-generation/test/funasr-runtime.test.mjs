import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalCuesFromParaformer,
  canonicalCuesFromSenseVoice,
  parseSenseVoiceSegments,
  parseVadSegments,
  splitSubtitleText,
} from '../src/funasr-runtime.mjs';

test('parses shared FSMN-VAD millisecond ranges', () => {
  assert.deepEqual(parseVadSegments('490 30490\n30490 46950\n'), [
    { startMs: 490, endMs: 30_490 },
    { startMs: 30_490, endMs: 46_950 },
  ]);
});

test('parses tagged SenseVoice segments without leaking model tags', () => {
  assert.deepEqual(
    parseSenseVoiceSegments(
      '<|zh|><|HAPPY|><|Speech|><|withitn|>第一段。<|zh|><|NEUTRAL|><|Speech|><|withitn|>第二段。',
    ),
    [
      {
        language: 'zh',
        emotion: 'HAPPY',
        event: 'Speech',
        textNormalization: 'withitn',
        text: '第一段。',
      },
      {
        language: 'zh',
        emotion: 'NEUTRAL',
        event: 'Speech',
        textNormalization: 'withitn',
        text: '第二段。',
      },
    ],
  );
});

test('splits readable subtitle text at punctuation', () => {
  assert.deepEqual(splitSubtitleText('人工智能、机器学习，这是一句话。下一句。', 12), [
    '人工智能、机器学习，',
    '这是一句话。下一句。',
  ]);
});

test('maps recognized text to VAD timing and preserves the complete interval', () => {
  const cues = canonicalCuesFromSenseVoice(
    [{ startMs: 500, endMs: 10_500 }],
    [{ language: 'zh', emotion: 'NEUTRAL', event: 'Speech', text: '第一句话。第二句话。' }],
    6,
  );
  assert.equal(cues[0].startMs, 500);
  assert.equal(cues.at(-1).endMs, 10_500);
  assert.equal(cues.map((cue) => cue.text).join(''), '第一句话。第二句话。');
  assert.ok(cues.every((cue) => cue.timingSource === 'fsmn-vad-proportional'));
});

test('fails when recognition and VAD segment counts diverge', () => {
  assert.throws(
    () => canonicalCuesFromSenseVoice(
      [{ startMs: 0, endMs: 1_000 }],
      [],
    ),
    /segment count mismatch/u,
  );
});

test('maps unpunctuated Paraformer text across VAD speech ranges', () => {
  const cues = canonicalCuesFromParaformer(
    [
      { startMs: 500, endMs: 5_500 },
      { startMs: 8_000, endMs: 13_000 },
    ],
    '一二三四五六七八九十',
    3,
  );
  assert.equal(cues.map((cue) => cue.text).join(''), '一二三四五六七八九十');
  assert.equal(cues[0].startMs, 500);
  assert.equal(cues.at(-1).endMs, 13_000);
  assert.ok(cues.every((cue) => cue.timingSource === 'fsmn-vad-global-proportional'));
  assert.ok(cues.every((cue) => cue.punctuationSource === 'none'));
  assert.ok(cues.every((cue) => cue.endMs <= 5_500 || cue.startMs >= 8_000));
});

test('rejects empty Paraformer output', () => {
  assert.throws(
    () => canonicalCuesFromParaformer([{ startMs: 0, endMs: 1_000 }], ''),
    /did not return text/u,
  );
});
