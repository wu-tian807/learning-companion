import assert from "node:assert/strict";
import test from "node:test";

import {
  contiguousSuffixStartMs,
  createReverseSuffixOrder,
  describeAdaptiveSuffixStrategy,
  predictAdaptiveRendezvous,
  rollingTimelineRtf,
  selectRightEdgeProbeCue,
  timelineRtf,
} from "../src/adaptive-suffix-strategy.mjs";

const cues = Object.freeze([
  { id: "a", startMs: 0, endMs: 3_000, text: "first spoken line" },
  { id: "b", startMs: 4_000, endMs: 8_000, text: "middle spoken line" },
  { id: "c", startMs: 9_000, endMs: 14_000, text: "last suitable spoken line" },
  { id: "d", startMs: 14_500, endMs: 15_000, text: "end" },
]);

test("chooses a stable probe near the right edge instead of a tiny last cue", () => {
  assert.equal(selectRightEdgeProbeCue(cues).id, "c");
});

test("reuses the probe as the first real suffix result", () => {
  assert.deepEqual(
    createReverseSuffixOrder(cues, "c").map(({ id }) => id),
    ["c", "d", "b", "a"],
  );
});

test("uses media timeline duration for scheduling RTF", () => {
  assert.equal(timelineRtf(2, cues[1]), 0.5);
  assert.equal(rollingTimelineRtf([0.8, 0.4, 0.6]), 0.6);
});

test("reports only the contiguous completed suffix as playable", () => {
  assert.equal(contiguousSuffixStartMs(cues, new Set(["d"]), 15_000), 14_500);
  assert.equal(
    contiguousSuffixStartMs(cues, new Set(["b", "d"]), 15_000),
    14_500,
  );
  assert.equal(
    contiguousSuffixStartMs(cues, new Set(["b", "c", "d"]), 15_000),
    4_000,
  );
});

test("predicts the same 20-minute rendezvous from measured RTF 0.5", () => {
  const prediction = predictAdaptiveRendezvous({
    durationMs: 1_200_000,
    rtf: 0.5,
  });
  assert.equal(prediction.reachableBeforeEnd, true);
  assert.ok(Math.abs(prediction.wallSecondsUntilSwitch - 400) < 1e-9);
  assert.equal(prediction.switchAtMs, 400_000);
  assert.equal(prediction.continuousSuffixMs, 800_000);
});

test("strategy labels describe speed without changing suffix truth", () => {
  assert.equal(describeAdaptiveSuffixStrategy(0.4).id, "fast-suffix");
  assert.equal(describeAdaptiveSuffixStrategy(0.8).id, "balanced-suffix");
  assert.equal(describeAdaptiveSuffixStrategy(1.2).id, "patient-suffix");
});

test("rejects missing and invalid RTF measurements", () => {
  assert.throws(() => rollingTimelineRtf([]), /at least one/u);
  assert.throws(() => describeAdaptiveSuffixStrategy(0), /positive/u);
});
