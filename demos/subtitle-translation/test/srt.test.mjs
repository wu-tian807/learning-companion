import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, toSrt } from '../src/srt.mjs';

test('parses multiline SRT cues and normalizes their text', () => {
  const cues = parseSrt(
    '1\r\n00:00:00,100 --> 00:00:01,500\r\nHello\r\nworld\r\n\r\n2\r\n00:00:02.000 --> 00:00:03.000\r\n你好\r\n',
  );
  assert.deepEqual(cues, [
    { id: 'cue-000001', startMs: 100, endMs: 1500, text: 'Hello world' },
    { id: 'cue-000002', startMs: 2000, endMs: 3000, text: '你好' },
  ]);
});

test('writes source, translated or bilingual cue text with stable timing', () => {
  const cues = [{ id: 'cue-000001', startMs: 100, endMs: 1500, text: 'Hello', translatedText: '你好' }];
  assert.equal(toSrt(cues, (cue) => `${cue.text}\n${cue.translatedText}`), '1\n00:00:00,100 --> 00:00:01,500\nHello\n你好\n');
});

test('rejects unordered or invalid cue timing', () => {
  assert.throws(() => parseSrt('1\ninvalid\ntext\n'), /no timing/u);
  assert.throws(
    () => parseSrt('1\n00:00:02,000 --> 00:00:03,000\na\n\n2\n00:00:01,000 --> 00:00:02,000\nb\n'),
    /ordered/u,
  );
});
