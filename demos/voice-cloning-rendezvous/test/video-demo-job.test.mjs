import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  mergeCompletedModelAudioFiles,
  parseWhisperSegments,
  replaceFileWithRetry,
  runCommand,
  selectReferenceWindow,
  VideoDemoJob,
  writeJsonAtomically,
} from "../src/video-demo-job.mjs";

const testRuntimeRoot = fileURLToPath(
  new URL("../.runtime/tests/", import.meta.url),
);

test("keeps only real Whisper segment timestamps", () => {
  const track = parseWhisperSegments(
    {
      result: { language: "en" },
      transcription: [
        { offsets: { from: 100, to: 2_400 }, text: " Hello world. " },
        { offsets: { from: 2_800, to: 6_100 }, text: " This is the demo. " },
      ],
    },
    "source-revision",
    42,
  );

  assert.equal(track.language, "en");
  assert.deepEqual(
    track.cues.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })),
    [
      { startMs: 100, endMs: 2_400, text: "Hello world." },
      { startMs: 2_800, endMs: 6_100, text: "This is the demo." },
    ],
  );
});

test("normalizes Chinese Whisper output for Chinese-to-English dubbing", () => {
  const track = parseWhisperSegments(
    {
      result: { language: "zh" },
      transcription: [
        { offsets: { from: 0, to: 2_200 }, text: "今天我们验证声音克隆。" },
      ],
    },
    "chinese-source",
    42,
  );

  assert.equal(track.language, "zh-Hans");
  assert.equal(track.cues[0].text, "今天我们验证声音克隆。");
});

test("does not invent timestamps for overlapping Whisper output", () => {
  assert.throws(
    () =>
      parseWhisperSegments(
        {
          result: { language: "en" },
          transcription: [
            { offsets: { from: 100, to: 2_400 }, text: "first" },
            { offsets: { from: 2_000, to: 3_000 }, text: "overlap" },
          ],
        },
        "source-revision",
      ),
    /real timestamp/u,
  );
});

test("automatically selects a contiguous multi-cue one-shot window", () => {
  const window = selectReferenceWindow([
    { id: "a", startMs: 0, endMs: 2_000, text: "This is the first sentence." },
    { id: "b", startMs: 2_200, endMs: 5_800, text: "It continues naturally." },
    { id: "c", startMs: 8_000, endMs: 12_000, text: "A distant sentence." },
  ]);
  assert.deepEqual(window.sourceCueIds, ["a", "b"]);
  assert.equal(window.startMs, 0);
  assert.equal(window.endMs, 5_800);
});

test("publishes complete JSON and leaves no temporary manifest", async () => {
  await mkdir(testRuntimeRoot, { recursive: true });
  const root = await mkdtemp(join(testRuntimeRoot, "atomic-json-"));
  try {
    const manifestPath = join(root, "manifest.json");
    await writeJsonAtomically(manifestPath, {
      phase: "cancelled",
      cues: [1, 2, 3],
    });

    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), {
      phase: "cancelled",
      cues: [1, 2, 3],
    });
    assert.deepEqual(await readdir(root), ["manifest.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes a long prompt through stdin without using a Windows command argument", async () => {
  const payload = "字幕上下文".repeat(10_000);
  const result = await runCommand({
    command: process.execPath,
    args: [
      "-e",
      "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(String(s.length)))",
    ],
    input: payload,
    timeoutMs: 10_000,
  });
  assert.equal(result.stdout, String(payload.length));
});

test("retries transient Windows file replacement failures", async () => {
  let attempts = 0;
  const waits = [];
  await replaceFileWithRetry("manifest.tmp", "manifest.json", {
    renameFile: async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("temporarily locked");
        error.code = "EPERM";
        throw error;
      }
    },
    wait: async (milliseconds) => waits.push(milliseconds),
    retryDelays: [10, 20, 40],
  });

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [10, 20]);
});

test("does not hide a non-transient file replacement failure", async () => {
  let attempts = 0;
  await assert.rejects(
    replaceFileWithRetry("manifest.tmp", "manifest.json", {
      renameFile: async () => {
        attempts += 1;
        const error = new Error("invalid path");
        error.code = "EINVAL";
        throw error;
      },
      wait: async () => undefined,
      retryDelays: [0, 0],
    }),
    /invalid path/u,
  );
  assert.equal(attempts, 1);
});

test("recovers completed cue files that were written before a manifest failure", () => {
  const audioFiles = mergeCompletedModelAudioFiles(
    "f5tts",
    [{ id: "cue-1" }, { id: "cue-2" }],
    { "cue-1": "audio/f5tts/cue-1.wav" },
    ["cue-1.wav", "cue-2.wav", "unrelated.wav", "notes.txt"],
  );

  assert.deepEqual(audioFiles, {
    "cue-1": "audio/f5tts/cue-1.wav",
    "cue-2": "audio/f5tts/cue-2.wav",
  });
});

test("resumes model generation without repeating transcription and translation", async () => {
  await mkdir(testRuntimeRoot, { recursive: true });
  const root = await mkdtemp(join(testRuntimeRoot, "resume-generation-"));
  try {
    const manifestPath = join(root, "manifest.json");
    const targetCues = [
      {
        id: "cue-1",
        startMs: 0,
        endMs: 1_000,
        text: "你好",
        sourceText: "hello",
      },
    ];
    const manifest = {
      id: "session-id",
      phase: "generating",
      tracks: { targetCuesFile: "target-cues.json" },
      separation: {
        vocalsFile: "stems/vocals.wav",
        backgroundFile: "stems/background.wav",
      },
      reference: { file: "reference.wav" },
      probeCueId: "cue-1",
      models: Object.fromEntries(
        ["f5tts", "voxcpm15", "voxcpm2"].map((id) => [
          id,
          {
            id,
            status: "queued",
            completedCues: 0,
            totalCues: 1,
            audioFiles: {},
          },
        ]),
      ),
    };
    await writeJsonAtomically(manifestPath, manifest);
    await writeJsonAtomically(join(root, "target-cues.json"), {
      plannerVersion: 2,
      durationMs: 1_000,
      cues: targetCues,
    });
    const job = new VideoDemoJob({
      manifest,
      manifestPath,
      sessionRoot: root,
      inputPath: join(root, "input.mp4"),
      runtime: { env: {} },
    });
    job.transcribe = async () => {
      throw new Error("transcription must not run during resume");
    };
    const resumedModels = [];
    job.runModel = async (model, cues) => {
      resumedModels.push({ id: model.id, cues: cues.length });
    };

    await job.run(new AbortController().signal);

    assert.deepEqual(resumedModels, [
      { id: "f5tts", cues: 1 },
      { id: "voxcpm15", cues: 1 },
      { id: "voxcpm2", cues: 1 },
    ]);
    assert.equal(
      JSON.parse(await readFile(manifestPath, "utf8")).phase,
      "completed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses the separated vocal stem for the one-shot reference", async () => {
  await mkdir(testRuntimeRoot, { recursive: true });
  const root = await mkdtemp(join(testRuntimeRoot, "separated-reference-"));
  try {
    const manifestPath = join(root, "manifest.json");
    const manifest = {
      id: "session-id",
      phase: "uploaded",
      uploadedTime: 42,
      video: {},
    };
    await writeJsonAtomically(manifestPath, manifest);
    const job = new VideoDemoJob({
      manifest,
      manifestPath,
      sessionRoot: root,
      inputPath: join(root, "input.mp4"),
      runtime: { env: {} },
    });
    const stages = [];
    job.transcribe = async () => ({
      durationMs: 2_000,
      source: {
        cues: [{ id: "cue-1", startMs: 0, endMs: 2_000, text: "hello" }],
      },
    });
    job.separateAudio = async () => {
      stages.push("separate");
      return {
        vocalsFile: "stems/vocals.wav",
        backgroundFile: "stems/background.wav",
      };
    };
    job.translate = async () => {
      stages.push("translate");
      return {
        sourceLanguage: "en",
        targetLanguage: "zh-Hans",
        directionLabel: "英语 → 中文",
        cues: [{ text: "你好" }],
      };
    };
    job.extractReference = async (_source, vocalsPath) => {
      stages.push("reference");
      assert.equal(vocalsPath, join(root, "stems", "vocals.wav"));
      return { file: "reference.wav" };
    };
    job.runModel = async () => undefined;

    await job.run(new AbortController().signal);

    assert.deepEqual(stages, ["separate", "translate", "reference"]);
    const completed = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(completed.phase, "completed");
    assert.equal(completed.separation.backgroundFile, "stems/background.wav");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
