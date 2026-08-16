import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanReferenceText,
  parseVtt,
  referenceTextBefore,
  subtitleStructure,
  subtitleTimingAgreement,
} from '../src/reference-vtt.mjs';

test('parses manual WebVTT cues and ignores headers', () => {
  const cues = parseVtt(`WEBVTT\nKind: captions\n\n00:00:00.500 --> 00:00:02.000\nSPEAKER: Hello &amp; welcome.\n\n00:00:02.100 --> 00:00:04.000\nSecond line.`);
  assert.deepEqual(cues, [
    { startMs: 500, endMs: 2_000, text: 'Hello & welcome.' },
    { startMs: 2_100, endMs: 4_000, text: 'Second line.' },
  ]);
});

test('cleans markup, speaker labels and non-speech annotations', () => {
  assert.equal(cleanReferenceText("<c>ERIC GRIMSON:</c> [MUSIC] It&#39;s <b>ready</b>."), "It's ready.");
  assert.equal(cleanReferenceText("ERIC GRIMSON: It's ready."), "It's ready.");
});

test('uses only complete reference cues before a clip boundary', () => {
  const cues = [
    { startMs: 0, endMs: 900, text: 'one' },
    { startMs: 900, endMs: 1_100, text: 'partial' },
  ];
  assert.equal(referenceTextBefore(cues, 1_000), 'one');
});

test('reports structural subtitle problems', () => {
  const structure = subtitleStructure([
    { startMs: 0, endMs: 8_000, text: 'a'.repeat(85) },
    { startMs: 7_000, endMs: 9_000, text: '' },
  ], 10_000);
  assert.equal(structure.overlapCount, 1);
  assert.equal(structure.longDurationCount, 1);
  assert.equal(structure.longTextCount, 1);
  assert.equal(structure.emptyCount, 1);
  assert.equal(structure.speechCoverageRate, 0.9);
  assert.equal(structure.maximumCharactersPerCue, 85);
  assert.equal(structure.averageDurationMs, 5_000);
  assert.equal(structure.maximumDurationMs, 8_000);
});

test('compares generated and reference speech timing without double-counting overlaps', () => {
  const agreement = subtitleTimingAgreement(
    [
      { startMs: 0, endMs: 2_000, text: 'reference one' },
      { startMs: 1_500, endMs: 3_000, text: 'reference two' },
    ],
    [
      { startMs: 1_000, endMs: 2_500, text: 'generated' },
    ],
    4_000,
  );
  assert.equal(agreement.referenceDurationMs, 3_000);
  assert.equal(agreement.generatedDurationMs, 1_500);
  assert.equal(agreement.intersectionDurationMs, 1_500);
  assert.equal(agreement.speechPrecision, 1);
  assert.equal(agreement.speechRecall, 0.5);
  assert.equal(agreement.speechIntersectionOverUnion, 0.5);
});
