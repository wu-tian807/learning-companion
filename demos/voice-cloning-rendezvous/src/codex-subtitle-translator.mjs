import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_MAXIMUM_CHUNK_CHARACTERS = 60_000;
const DEFAULT_MAXIMUM_CHUNK_CUES = 240;
const MAXIMUM_REPAIR_ATTEMPTS = 1;

function normalizedText(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function translationDirection(sourceLanguage) {
  if (sourceLanguage === "en") {
    return Object.freeze({
      sourceLanguage: "en",
      targetLanguage: "zh-Hans",
      label: "英语 → 中文",
    });
  }
  if (sourceLanguage === "zh-Hans") {
    return Object.freeze({
      sourceLanguage: "zh-Hans",
      targetLanguage: "en",
      label: "中文 → 英语",
    });
  }
  throw new Error(`暂不支持 ${sourceLanguage || "未知语言"} 的反向配音实验`);
}

export function createTranslationChunks(
  cues,
  {
    maximumCharacters = DEFAULT_MAXIMUM_CHUNK_CHARACTERS,
    maximumCues = DEFAULT_MAXIMUM_CHUNK_CUES,
    lookaheadCues = 2,
  } = {},
) {
  if (!Array.isArray(cues) || cues.length === 0) {
    throw new TypeError("cues must contain at least one subtitle");
  }
  if (maximumCharacters <= 0 || maximumCues <= 0 || lookaheadCues < 0) {
    throw new RangeError("translation chunk limits must be positive");
  }

  const chunks = [];
  let start = 0;
  while (start < cues.length) {
    let end = start;
    let characters = 0;
    while (end < cues.length && end - start < maximumCues) {
      const nextLength = normalizedText(cues[end]?.text).length;
      if (end > start && characters + nextLength > maximumCharacters) break;
      characters += nextLength;
      end += 1;
    }
    if (end === start) end += 1;
    chunks.push(
      Object.freeze({
        index: chunks.length,
        cues: Object.freeze(cues.slice(start, end)),
        lookahead: Object.freeze(cues.slice(end, end + lookaheadCues)),
      }),
    );
    start = end;
  }
  return Object.freeze(chunks);
}

function cuePayload(cue) {
  const sourceCueId = normalizedText(cue?.id);
  const text = normalizedText(cue?.text);
  if (!sourceCueId || !text) throw new Error("字幕 Cue 缺少 id 或文本");
  return { sourceCueId, text };
}

export function buildTranslationPrompt({ chunk, direction, totalChunks }) {
  const target =
    direction.targetLanguage === "zh-Hans" ? "简体中文" : "自然英语";
  const continuity =
    chunk.index === 0
      ? "这是连续字幕翻译任务的第一段。"
      : "继续上一段的同一个字幕翻译任务，沿用已确立的人名、术语、语气和叙事关系。";
  const lookahead = chunk.lookahead.map(cuePayload);
  return [
    continuity,
    `将输入从 ${direction.sourceLanguage} 翻译为${target}，用于视频字幕与人声配音。`,
    "结合整段上下文理解代词，保持人名、术语、语气和叙事关系一致；译文要自然、简洁、可口语化朗读，不做逐句孤立的机械直译。",
    "不得合并、拆分、增删或改写 sourceCueId；输出顺序必须与 cues 完全一致。",
    "中文显示字幕保留阿拉伯数字，朗读时的数字转换由后续程序完成。",
    "lookahead 只用于理解当前段末尾，不得在本次输出中翻译它。",
    `当前分段：${chunk.index + 1}/${totalChunks}`,
    JSON.stringify(
      {
        cues: chunk.cues.map(cuePayload),
        lookahead,
      },
      null,
      2,
    ),
  ].join("\n\n");
}

function parseAssistantJson(value) {
  const text = normalizedText(value)
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  if (!text) throw new Error("Codex 没有返回翻译结果");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("Codex 返回的翻译不是有效 JSON", { cause: error });
  }
}

export function validateTranslatedCues(value, expectedCues) {
  if (!value || typeof value !== "object" || !Array.isArray(value.cues)) {
    throw new Error("Codex 翻译结果缺少 cues 数组");
  }
  if (value.cues.length !== expectedCues.length) {
    throw new Error(
      `Codex 翻译数量不一致：期望 ${expectedCues.length}，实际 ${value.cues.length}`,
    );
  }
  const seen = new Set();
  return expectedCues.map((expected, index) => {
    const actual = value.cues[index];
    const sourceCueId = normalizedText(actual?.sourceCueId);
    const text = normalizedText(actual?.text);
    if (sourceCueId !== expected.id) {
      throw new Error(
        `Codex 翻译 Cue 顺序或 ID 不一致：期望 ${expected.id}，实际 ${sourceCueId || "空"}`,
      );
    }
    if (seen.has(sourceCueId)) {
      throw new Error(`Codex 翻译重复了 Cue：${sourceCueId}`);
    }
    if (!text) throw new Error(`Codex 翻译 Cue ${sourceCueId} 为空`);
    seen.add(sourceCueId);
    return Object.freeze({ sourceCueId, text });
  });
}

function parseCodexEvent(line, state) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (event?.type === "thread.started" && typeof event.thread_id === "string") {
    state.threadId = event.thread_id;
  }
  if (
    event?.type === "item.completed" &&
    event.item?.type === "agent_message" &&
    typeof event.item.text === "string"
  ) {
    state.assistantOutput = event.item.text;
  }
  if (event?.type === "turn.completed" && event.usage) {
    state.usage = event.usage;
  }
}

async function executeCodexTurn({
  execute,
  runtime,
  workspace,
  threadId,
  prompt,
  signal,
}) {
  const state = {};
  const common = [
    "--json",
    "--ignore-rules",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--output-schema",
    runtime.codex.outputSchema,
    "-m",
    runtime.codex.model,
    "-c",
    `model_reasoning_effort="${runtime.codex.reasoningEffort}"`,
  ];
  const args = threadId
    ? [runtime.codex.cli, "exec", "resume", threadId, "-", ...common]
    : [
        runtime.codex.cli,
        "exec",
        "-",
        "--sandbox",
        "read-only",
        "-C",
        workspace,
        ...common,
      ];
  await execute({
    command: process.execPath,
    args,
    cwd: workspace,
    env: runtime.env,
    signal,
    input: prompt,
    onStdoutLine: (line) => parseCodexEvent(line, state),
  });
  if (!state.threadId) throw new Error("Codex 没有返回 thread ID");
  if (!state.assistantOutput) throw new Error("Codex 没有返回最终翻译");
  return state;
}

function repairPrompt(expectedCues, message) {
  return [
    "上一次输出未通过机械校验，请只修复输出结构，不要改变翻译任务。",
    `错误：${message}`,
    "必须按以下 ID 的顺序逐条返回，不多不少：",
    expectedCues.map(({ id }) => id).join(", "),
  ].join("\n\n");
}

export async function translateTrackWithCodex({
  source,
  runtime,
  sessionRoot,
  signal,
  onProgress,
  execute,
  chunkOptions,
}) {
  const direction = translationDirection(source.language);
  const chunks = createTranslationChunks(source.cues, chunkOptions);
  const workspace = resolve(sessionRoot, "translation-agent");
  await mkdir(workspace, { recursive: true });

  let threadId;
  let completed = 0;
  const translated = [];
  const usages = [];
  for (const chunk of chunks) {
    signal?.throwIfAborted();
    let prompt = buildTranslationPrompt({
      chunk,
      direction,
      totalChunks: chunks.length,
    });
    let validated;
    for (let attempt = 0; attempt <= MAXIMUM_REPAIR_ATTEMPTS; attempt += 1) {
      const turn = await executeCodexTurn({
        execute,
        runtime,
        workspace,
        threadId,
        prompt,
        signal,
      });
      threadId = turn.threadId;
      if (turn.usage) usages.push(turn.usage);
      try {
        validated = validateTranslatedCues(
          parseAssistantJson(turn.assistantOutput),
          chunk.cues,
        );
        break;
      } catch (error) {
        if (attempt === MAXIMUM_REPAIR_ATTEMPTS) throw error;
        prompt = repairPrompt(
          chunk.cues,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    translated.push(...validated);
    completed += chunk.cues.length;
    await onProgress(completed, source.cues.length);
  }

  return {
    version: 2,
    kind: "subtitle-translation",
    sourceTrackRevision: source.sourceRevision,
    sourceLanguage: direction.sourceLanguage,
    targetLanguage: direction.targetLanguage,
    directionLabel: direction.label,
    profile: "contextual-llm",
    engine: {
      id: "codex",
      version: runtime.codex.version,
      model: runtime.codex.model,
      reasoningEffort: runtime.codex.reasoningEffort,
      sessionId: threadId,
    },
    generatedTime: Date.now(),
    usage: usages,
    cues: translated,
  };
}
