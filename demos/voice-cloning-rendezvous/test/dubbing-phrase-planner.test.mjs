import assert from "node:assert/strict";
import test from "node:test";

import {
  createDubbingPhrases,
  normalizeChineseSpokenText,
} from "../src/dubbing-phrase-planner.mjs";

function cue(id, startMs, endMs, text, sourceText = text) {
  return { id, startMs, endMs, text, sourceText, sourceCueIds: [id] };
}

test("normalizes common Chinese numeral readings without changing prose", () => {
  assert.equal(
    normalizeChineseSpokenText(
      "2026年有123人，增长20%，版本GPT-5.6，时间3:05。",
    ),
    "二零二六年有一百二十三人，增长百分之二十，版本GPT-五点六，时间三点零五分。",
  );
  assert.equal(normalizeChineseSpokenText("001号"), "零零一号");
});

test("merges a short Cue into the previous real timing span", () => {
  const phrases = createDubbingPhrases(
    [
      cue("a", 0, 2_000, "今天我们讨论模型", "Today we discuss the model"),
      cue("b", 2_100, 2_700, "对吧", "right"),
    ],
    "zh-Hans",
  );
  assert.equal(phrases.length, 1);
  assert.equal(phrases[0].startMs, 0);
  assert.equal(phrases[0].endMs, 2_700);
  assert.deepEqual(phrases[0].sourceCueIds, ["a", "b"]);
  assert.equal(phrases[0].text, "今天我们讨论模型，对吧");
});

test("merges a leading short Cue forward when no previous phrase exists", () => {
  const phrases = createDubbingPhrases(
    [
      cue("a", 0, 500, "所以", "So"),
      cue("b", 600, 2_600, "我们从最后开始生成", "we start at the end"),
    ],
    "zh-Hans",
  );
  assert.equal(phrases.length, 1);
  assert.equal(phrases[0].id, "a");
  assert.deepEqual(phrases[0].sourceCueIds, ["a", "b"]);
});

test("merges a grammatically unfinished Cue even when it is not very short", () => {
  const phrases = createDubbingPhrases(
    [
      cue("a", 0, 2_900, "只要每天听几分钟，你就能"),
      cue("b", 2_900, 6_100, "通过训练你的"),
      cue("c", 6_100, 7_800, "思维变得更加积极，从而消除负面想法。"),
    ],
    "zh-Hans",
  );
  assert.equal(phrases.length, 2);
  assert.deepEqual(phrases[1].sourceCueIds, ["b", "c"]);
  assert.equal(phrases[1].startMs, 2_900);
  assert.equal(phrases[1].endMs, 7_800);
  assert.equal(
    phrases[1].text,
    "通过训练你的思维变得更加积极，从而消除负面想法。",
  );
});

test("does not merge across a long silence or beyond the phrase duration cap", () => {
  const longSilence = createDubbingPhrases(
    [cue("a", 0, 1_000, "完整句子"), cue("b", 2_000, 2_500, "对吧")],
    "zh-Hans",
  );
  assert.equal(longSilence.length, 2);

  const longDuration = createDubbingPhrases(
    [
      cue("a", 0, 7_900, "这是一个较长的字幕句子"),
      cue("b", 7_950, 8_300, "对吧"),
    ],
    "zh-Hans",
  );
  assert.equal(longDuration.length, 2);
});

test("uses the target-language short rule and preserves display digits", () => {
  const english = createDubbingPhrases(
    [
      cue("a", 0, 1_500, "This is the main sentence."),
      cue("b", 1_600, 2_000, "of course"),
    ],
    "en",
  );
  assert.equal(english.length, 1);

  const chinese = createDubbingPhrases(
    [cue("a", 0, 2_000, "2026年有123人", "There are 123 people in 2026")],
    "zh-Hans",
  );
  assert.equal(chinese[0].text, "2026年有123人");
  assert.equal(chinese[0].spokenText, "二零二六年有一百二十三人");
});

test("rejects overlapping input instead of inventing a corrected timestamp", () => {
  assert.throws(
    () =>
      createDubbingPhrases(
        [cue("a", 0, 1_000, "一句"), cue("b", 900, 1_500, "二句")],
        "zh-Hans",
      ),
    /invalid translated cue/u,
  );
});
