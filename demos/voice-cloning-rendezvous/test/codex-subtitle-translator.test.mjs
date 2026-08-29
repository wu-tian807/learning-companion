import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTranslationPrompt,
  createTranslationChunks,
  translateTrackWithCodex,
  translationDirection,
  validateTranslatedCues,
} from "../src/codex-subtitle-translator.mjs";

function source(cues) {
  return {
    language: "en",
    sourceRevision: "source-revision",
    cues: cues.map((text, index) => ({
      id: `cue-${index + 1}`,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      text,
    })),
  };
}

function runtime() {
  return {
    codex: {
      cli: "codex.js",
      outputSchema: "schema.json",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      version: "0.146.0",
    },
    env: {},
  };
}

function completeTurn(options, threadId, cues) {
  options.onStdoutLine(
    JSON.stringify({ type: "thread.started", thread_id: threadId }),
  );
  options.onStdoutLine(
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify({ cues }),
      },
    }),
  );
  options.onStdoutLine(
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 4 },
    }),
  );
}

test("selects the opposite supported language and rejects unknown input", () => {
  assert.deepEqual(translationDirection("en"), {
    sourceLanguage: "en",
    targetLanguage: "zh-Hans",
    label: "英语 → 中文",
  });
  assert.deepEqual(translationDirection("zh-Hans"), {
    sourceLanguage: "zh-Hans",
    targetLanguage: "en",
    label: "中文 → 英语",
  });
  assert.throws(() => translationDirection("ja"), /暂不支持/u);
});

test("chunks only at Cue boundaries and supplies lookahead context", () => {
  const chunks = createTranslationChunks(source(["one", "two", "three"]).cues, {
    maximumCues: 2,
    maximumCharacters: 1_000,
    lookaheadCues: 1,
  });
  assert.deepEqual(
    chunks.map((chunk) => ({
      ids: chunk.cues.map(({ id }) => id),
      lookahead: chunk.lookahead.map(({ id }) => id),
    })),
    [
      { ids: ["cue-1", "cue-2"], lookahead: ["cue-3"] },
      { ids: ["cue-3"], lookahead: [] },
    ],
  );
});

test("asks for contextual translation while keeping lookahead out of output", () => {
  const chunks = createTranslationChunks(source(["one", "two"]).cues, {
    maximumCues: 1,
    lookaheadCues: 1,
  });
  const prompt = buildTranslationPrompt({
    chunk: chunks[0],
    direction: translationDirection("en"),
    totalChunks: chunks.length,
  });
  assert.match(prompt, /人名、术语、语气和叙事关系/u);
  assert.match(prompt, /不得合并、拆分、增删/u);
  assert.match(prompt, /"sourceCueId": "cue-2"/u);
  assert.match(prompt, /lookahead 只用于/u);
});

test("rejects missing, duplicate, reordered, and empty Cue translations", () => {
  const expected = source(["one", "two"]).cues;
  assert.throws(
    () => validateTranslatedCues({ cues: [] }, expected),
    /翻译数量不一致/u,
  );
  assert.throws(
    () =>
      validateTranslatedCues(
        {
          cues: [
            { sourceCueId: "cue-2", text: "二" },
            { sourceCueId: "cue-1", text: "一" },
          ],
        },
        expected,
      ),
    /顺序或 ID 不一致/u,
  );
  assert.throws(
    () =>
      validateTranslatedCues(
        {
          cues: [
            { sourceCueId: "cue-1", text: "一" },
            { sourceCueId: "cue-2", text: " " },
          ],
        },
        expected,
      ),
    /为空/u,
  );
});

test("resumes one Codex thread across translation chunks", async () => {
  const calls = [];
  const execute = async (options) => {
    calls.push(options);
    const sourceCueId = calls.length === 1 ? "cue-1" : "cue-2";
    completeTurn(options, "thread-1", [
      { sourceCueId, text: sourceCueId === "cue-1" ? "一" : "二" },
    ]);
    return { stdout: "", stderr: "" };
  };
  const progress = [];
  const result = await translateTrackWithCodex({
    source: source(["one", "two"]),
    runtime: runtime(),
    sessionRoot: "translation-session",
    signal: new AbortController().signal,
    onProgress: async (completed, total) => progress.push([completed, total]),
    execute,
    chunkOptions: { maximumCues: 1 },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.includes("resume"), false);
  assert.deepEqual(calls[1].args.slice(0, 4), [
    "codex.js",
    "exec",
    "resume",
    "thread-1",
  ]);
  assert.deepEqual(progress, [
    [1, 2],
    [2, 2],
  ]);
  assert.equal(result.engine.sessionId, "thread-1");
  assert.deepEqual(
    result.cues.map(({ sourceCueId, text }) => ({ sourceCueId, text })),
    [
      { sourceCueId: "cue-1", text: "一" },
      { sourceCueId: "cue-2", text: "二" },
    ],
  );
});

test("repairs malformed output in the same Codex thread once", async () => {
  const calls = [];
  const execute = async (options) => {
    calls.push(options);
    completeTurn(
      options,
      "thread-repair",
      calls.length === 1 ? [] : [{ sourceCueId: "cue-1", text: "修复后" }],
    );
    return { stdout: "", stderr: "" };
  };
  const result = await translateTrackWithCodex({
    source: source(["repair me"]),
    runtime: runtime(),
    sessionRoot: "translation-session",
    signal: new AbortController().signal,
    onProgress: async () => undefined,
    execute,
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].input, /未通过机械校验/u);
  assert.equal(result.cues[0].text, "修复后");
});
