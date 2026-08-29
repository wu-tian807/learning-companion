import assert from "node:assert/strict";
import test from "node:test";

import { resolveDubPlayback } from "../src/dub-playback-policy.mjs";

const cues = [
  { id: "first", startMs: 1_000, endMs: 3_000 },
  { id: "second", startMs: 3_500, endMs: 5_000 },
];

test("plays the generated dub inside a Cue with an audio file", () => {
  assert.deepEqual(
    resolveDubPlayback({
      cues,
      audioFiles: { first: "first.wav" },
      positionMs: 2_000,
      generatedRegionStartMs: 1_000,
      backgroundAvailable: true,
    }),
    { mode: "dub", cue: cues[0], file: "first.wav" },
  );
});

test("uses background inside the generated region when a Cue is missing", () => {
  assert.deepEqual(
    resolveDubPlayback({
      cues,
      audioFiles: {},
      positionMs: 2_000,
      generatedRegionStartMs: 1_000,
      backgroundAvailable: true,
    }),
    { mode: "background" },
  );
});

test("uses background between generated Cues instead of leaking original speech", () => {
  assert.deepEqual(
    resolveDubPlayback({
      cues,
      audioFiles: { first: "first.wav" },
      positionMs: 3_400,
      generatedRegionStartMs: 1_000,
      backgroundAvailable: true,
    }),
    { mode: "background" },
  );
});

test("switches to the next generated Cue after a background gap", () => {
  assert.deepEqual(
    resolveDubPlayback({
      cues,
      audioFiles: { first: "first.wav", second: "second.wav" },
      positionMs: 3_600,
      generatedRegionStartMs: 1_000,
      backgroundAvailable: true,
    }),
    { mode: "dub", cue: cues[1], file: "second.wav" },
  );
});

test("keeps original audio before the contiguous generated region", () => {
  assert.deepEqual(
    resolveDubPlayback({
      cues,
      audioFiles: { first: "first.wav" },
      positionMs: 900,
      generatedRegionStartMs: 1_000,
      backgroundAvailable: true,
    }),
    { mode: "original" },
  );
});

test("keeps background after the last generated Cue", () => {
  assert.deepEqual(
    resolveDubPlayback({
      cues: cues.slice(0, 1),
      audioFiles: { first: "first.wav" },
      positionMs: 8_000,
      generatedRegionStartMs: 1_000,
      backgroundAvailable: true,
    }),
    { mode: "background" },
  );
});

test("falls back to original when the background stem is unavailable", () => {
  assert.deepEqual(
    resolveDubPlayback({
      cues,
      audioFiles: { first: "first.wav" },
      positionMs: 2_000,
      generatedRegionStartMs: 1_000,
      backgroundAvailable: false,
    }),
    { mode: "original" },
  );
});
