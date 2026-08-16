import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalCuesFromWhisper,
  measureAccuracy,
  parseWhisperCueLine,
  toSrt,
  toVtt,
  validateTranscript,
} from '../src/transcript.mjs';

test('parses a progressive whisper.cpp cue line', () => {
  assert.deepEqual(parseWhisperCueLine('[00:00:01.250 --> 00:00:03.500]  第一条字幕'), {
    startMs: 1_250,
    endMs: 3_500,
    text: '第一条字幕',
  });
  assert.equal(parseWhisperCueLine('whisper_init: loading model'), undefined);
});
test('converts whisper JSON into the canonical cue contract', () => {
  const cues = canonicalCuesFromWhisper({
    transcription: [
      { offsets: { from: 0, to: 1_200 }, text: ' hello ' },
      { offsets: { from: 1_200, to: 2_500 }, text: 'world' },
    ],
  });
  assert.deepEqual(cues, [
    { id: 'cue-000001', startMs: 0, endMs: 1_200, text: 'hello', state: 'final' },
    { id: 'cue-000002', startMs: 1_200, endMs: 2_500, text: 'world', state: 'final' },
  ]);
});

test('writes valid SRT and WebVTT timestamps', () => {
  const cues = [{ id: 'cue-000001', startMs: 1_250, endMs: 3_500, text: '字幕', state: 'final' }];
  assert.match(toSrt(cues), /00:00:01,250 --> 00:00:03,500/u);
  assert.match(toVtt(cues), /^WEBVTT\n\n00:00:01\.250 --> 00:00:03\.500/u);
});

test('measures Chinese CER and English WER', () => {
  assert.deepEqual(measureAccuracy('你好世界', '你好世间', 'zh'), {
    metric: 'cer',
    distance: 1,
    referenceUnits: 4,
    hypothesisUnits: 4,
    rate: 0.25,
  });
  assert.equal(measureAccuracy('hello brave world', 'hello world', 'en').rate, 1 / 3);
});

test('rejects malformed or unordered canonical cues', () => {
  assert.throws(
    () =>
      validateTranscript({
        schemaVersion: 1,
        artifactType: 'media.transcript.v1',
        cues: [
          { id: 'b', startMs: 2_000, endMs: 3_000, text: 'later' },
          { id: 'a', startMs: 1_000, endMs: 2_000, text: 'earlier' },
        ],
      }),
    /ordered/u,
  );
});
