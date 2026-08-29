import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceChunkSchedule,
  advanceSuffixStart,
  hasGeneratedCoverage,
  predictSuffixRendezvous,
} from "../src/rendezvous.mjs";

test("RTF 0.5 meets a 20-minute video at 6:40", () => {
  const result = predictSuffixRendezvous({
    durationSeconds: 1_200,
    playbackSeconds: 0,
    rtf: 0.5,
  });

  assert.equal(result.reachableBeforeEnd, true);
  assert.equal(result.wallSecondsUntilSwitch, 400);
  assert.equal(result.switchAtSeconds, 400);
  assert.equal(result.continuousSuffixSeconds, 800);
});

test("official RTX 4090 RTF estimate produces a much earlier switch", () => {
  const result = predictSuffixRendezvous({
    durationSeconds: 1_200,
    playbackSeconds: 0,
    rtf: 0.15,
  });

  assert.ok(Math.abs(result.wallSecondsUntilSwitch - 156.5217) < 0.001);
  assert.ok(Math.abs(result.continuousSuffixSeconds - 1_043.4783) < 0.001);
});

test("an RTF above one still yields a truthful but short suffix", () => {
  const result = predictSuffixRendezvous({
    durationSeconds: 1_200,
    playbackSeconds: 0,
    rtf: 1.76,
  });

  assert.ok(Math.abs(result.wallSecondsUntilSwitch - 765.2174) < 0.001);
  assert.ok(Math.abs(result.continuousSuffixSeconds - 434.7826) < 0.001);
});

test("seeking forward recalculates the rendezvous without discarding suffix work", () => {
  const result = predictSuffixRendezvous({
    durationSeconds: 1_200,
    playbackSeconds: 600,
    generatedSuffixStartSeconds: 1_000,
    rtf: 0.5,
  });

  assert.ok(Math.abs(result.wallSecondsUntilSwitch - 133.3333) < 0.001);
  assert.ok(Math.abs(result.switchAtSeconds - 733.3333) < 0.001);
});

test("cold startup is included in the first switch prediction", () => {
  const result = predictSuffixRendezvous({
    durationSeconds: 1_200,
    playbackSeconds: 0,
    rtf: 0.5,
    startupSeconds: 8,
  });

  assert.ok(Math.abs(result.wallSecondsUntilSwitch - 405.3333) < 0.001);
  assert.ok(Math.abs(result.switchAtSeconds - 405.3333) < 0.001);
});

test("a startup longer than the remaining playback reports no switch", () => {
  const result = predictSuffixRendezvous({
    durationSeconds: 60,
    playbackSeconds: 30,
    playbackRate: 1,
    rtf: 0.15,
    startupSeconds: 30,
  });

  assert.equal(result.reachableBeforeEnd, false);
  assert.equal(result.switchAtSeconds, 60);
  assert.equal(result.continuousSuffixSeconds, 0);
});

test("generation advances from the end toward the playhead", () => {
  assert.equal(
    advanceSuffixStart({
      durationSeconds: 1_200,
      generatedSuffixStartSeconds: 1_200,
      wallSeconds: 20,
      rtf: 0.5,
    }),
    1_160,
  );
});

test("coverage requires a non-empty generated suffix", () => {
  assert.equal(
    hasGeneratedCoverage({
      playbackSeconds: 1_200,
      generatedSuffixStartSeconds: 1_200,
      durationSeconds: 1_200,
    }),
    false,
  );
  assert.equal(
    hasGeneratedCoverage({
      playbackSeconds: 800,
      generatedSuffixStartSeconds: 790,
      durationSeconds: 1_200,
    }),
    true,
  );
});

test("measured chunk progress advances only after a real segment completes", () => {
  const schedule = [{ generationSeconds: 2, outputSeconds: 5 }];
  const partial = advanceChunkSchedule({
    generatedSuffixStartSeconds: 60,
    wallSeconds: 1.5,
    schedule,
  });
  assert.equal(partial.generatedSuffixStartSeconds, 60);
  assert.equal(partial.segmentWallRemaining, 0.5);

  const completed = advanceChunkSchedule({
    generatedSuffixStartSeconds: partial.generatedSuffixStartSeconds,
    wallSeconds: 0.5,
    schedule,
    scheduleIndex: partial.scheduleIndex,
    segmentWallRemaining: partial.segmentWallRemaining,
  });
  assert.equal(completed.generatedSuffixStartSeconds, 55);
});

test("measured chunk progress can finish multiple segments in one frame", () => {
  const advanced = advanceChunkSchedule({
    generatedSuffixStartSeconds: 30,
    wallSeconds: 4.5,
    schedule: [
      { generationSeconds: 1, outputSeconds: 4 },
      { generationSeconds: 2, outputSeconds: 7 },
    ],
  });
  assert.equal(advanced.generatedSuffixStartSeconds, 15);
  assert.equal(advanced.scheduleIndex, 1);
  assert.equal(advanced.segmentWallRemaining, 1.5);
});
