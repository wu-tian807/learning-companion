import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";

import {
  contiguousSuffixStartMs,
  createReverseSuffixOrder,
  describeAdaptiveSuffixStrategy,
  predictAdaptiveRendezvous,
  rollingTimelineRtf,
  selectRightEdgeProbeCue,
} from "./adaptive-suffix-strategy.mjs";
import { translateTrackWithCodex } from "./codex-subtitle-translator.mjs";
import {
  createDubbingPhrases,
  DUBBING_PHRASE_PLANNER_VERSION,
} from "./dubbing-phrase-planner.mjs";

const COMMAND_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const FILE_REPLACE_RETRY_DELAYS_MS = Object.freeze([
  20, 40, 80, 160, 320, 640, 1_000, 1_000,
]);
const TRANSIENT_FILE_REPLACE_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

export const VIDEO_DEMO_MODELS = Object.freeze([
  Object.freeze({ id: "f5tts", label: "F5-TTS v1 Base" }),
  Object.freeze({ id: "voxcpm15", label: "VoxCPM1.5" }),
  Object.freeze({ id: "voxcpm2", label: "VoxCPM2" }),
]);

function abortError() {
  return new DOMException("Video voice job cancelled", "AbortError");
}

function waitForFileReplace(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

export async function replaceFileWithRetry(
  source,
  destination,
  {
    renameFile = rename,
    wait = waitForFileReplace,
    retryDelays = FILE_REPLACE_RETRY_DELAYS_MS,
  } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      const retryDelay = retryDelays[attempt];
      if (
        retryDelay === undefined ||
        !error ||
        typeof error !== "object" ||
        !TRANSIENT_FILE_REPLACE_CODES.has(error.code)
      ) {
        throw error;
      }
      await wait(retryDelay);
    }
  }
}

export async function writeJsonAtomically(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx");
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await replaceFileWithRetry(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function mergeCompletedModelAudioFiles(
  modelId,
  targetCues,
  recordedAudioFiles,
  outputFileNames,
) {
  const cueIds = new Set(targetCues.map(({ id }) => id));
  const audioFiles = Object.fromEntries(
    Object.entries(recordedAudioFiles ?? {}).filter(([cueId]) =>
      cueIds.has(cueId),
    ),
  );
  for (const fileName of outputFileNames) {
    if (!fileName.endsWith(".wav")) continue;
    const cueId = fileName.slice(0, -".wav".length);
    if (cueIds.has(cueId)) {
      audioFiles[cueId] = `audio/${modelId}/${fileName}`;
    }
  }
  return audioFiles;
}

function appendBounded(chunks, chunk, maximum = 128_000) {
  chunks.push(String(chunk));
  let length = chunks.reduce((sum, item) => sum + item.length, 0);
  while (length > maximum && chunks.length > 1) {
    length -= chunks.shift().length;
  }
}

function terminateChildTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return;
  }
  const terminator = spawn(
    "taskkill.exe",
    ["/pid", String(child.pid), "/t", "/f"],
    {
      windowsHide: true,
      shell: false,
      stdio: "ignore",
    },
  );
  terminator.unref();
}

export async function runCommand({
  command,
  args,
  cwd,
  env,
  signal,
  timeoutMs = COMMAND_TIMEOUT_MS,
  onStdoutLine,
  input,
}) {
  signal?.throwIfAborted();
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let launchError;
    let forcedError;
    let forceFinishTimer;
    const stop = (error) => {
      if (settled || forcedError) return;
      forcedError = error;
      terminateChildTree(child);
      forceFinishTimer = setTimeout(() => finish(error), 5_000);
    };
    const timeout = setTimeout(() => {
      stop(new Error(`External command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const abort = () => stop(abortError());
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceFinishTimer);
      signal?.removeEventListener("abort", abort);
      if (error) rejectPromise(error);
      else resolvePromise(result);
    };

    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      launchError = error;
    });
    if (child.stdin) {
      child.stdin.once("error", (error) => {
        launchError ??= error;
      });
      child.stdin.end(input);
    }
    child.stdout.on("data", (chunk) => appendBounded(stdout, chunk));
    child.stderr.on("data", (chunk) => appendBounded(stderr, chunk));
    if (onStdoutLine) {
      const lines = createInterface({ input: child.stdout });
      lines.on("line", onStdoutLine);
    }
    child.once("exit", (code, exitSignal) => {
      const result = {
        code,
        signal: exitSignal,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      };
      if (forcedError) {
        finish(forcedError);
      } else if (launchError) {
        finish(launchError);
      } else if (code !== 0) {
        finish(
          new Error(
            `External command failed (${String(code ?? exitSignal)}): ${command}\n${result.stderr.slice(-24_000)}`,
          ),
        );
      } else {
        finish(undefined, result);
      }
    });
  });
}

function normalizedLanguage(value) {
  const language = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
  if (language === "en" || language.startsWith("en-")) return "en";
  if (language === "zh" || language.startsWith("zh-")) return "zh-Hans";
  return "unknown";
}

export function parseWhisperSegments(value, sourceRevision, now = Date.now()) {
  const language = normalizedLanguage(value?.result?.language);
  if (!Array.isArray(value?.transcription)) {
    throw new Error("Whisper did not return a transcription array");
  }
  let previousEnd = -1;
  const cues = value.transcription.flatMap((segment, index) => {
    const text = String(segment?.text ?? "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!text) return [];
    const startMs = Math.round(Number(segment?.offsets?.from));
    const endMs = Math.round(Number(segment?.offsets?.to));
    if (
      !Number.isSafeInteger(startMs) ||
      !Number.isSafeInteger(endMs) ||
      startMs < previousEnd ||
      endMs <= startMs
    ) {
      throw new Error("Whisper returned an invalid real timestamp range");
    }
    previousEnd = endMs;
    const id = `cue-${String(index + 1).padStart(6, "0")}`;
    return [{ id, startMs, endMs, text, sourceCueIds: [id] }];
  });
  if (cues.length === 0) throw new Error("Whisper did not detect speech");
  return {
    version: 1,
    kind: "subtitle-source",
    sourceRevision,
    language,
    origin: "asr",
    engine: {
      id: "whisper.cpp",
      version: "1.9.2",
      model: "large-v3-turbo-q5_0",
      backend: "cuda",
    },
    generatedTime: now,
    cues,
  };
}

export function selectReferenceWindow(cues) {
  if (!Array.isArray(cues) || cues.length === 0) {
    throw new TypeError("cues must contain speech");
  }
  let best;
  for (let start = 0; start < cues.length; start += 1) {
    let text = "";
    for (let end = start; end < Math.min(cues.length, start + 4); end += 1) {
      const cue = cues[end];
      if (end > start && cue.startMs - cues[end - 1].endMs > 700) break;
      text = `${text} ${cue.text}`.trim();
      const durationMs = cue.endMs - cues[start].startMs;
      if (durationMs > 10_000) break;
      if (durationMs < 3_000 || text.length < 20) continue;
      const score = Math.abs(durationMs - 6_000) + start * 20;
      if (!best || score < best.score) {
        best = {
          startMs: cues[start].startMs,
          endMs: cue.endMs,
          text,
          sourceCueIds: cues.slice(start, end + 1).map(({ id }) => id),
          score,
        };
      }
    }
  }
  const fallback = cues[0];
  return (
    best ?? {
      startMs: fallback.startMs,
      endMs: fallback.endMs,
      text: fallback.text,
      sourceCueIds: [fallback.id],
    }
  );
}

function publicPath(sessionRoot, absolutePath) {
  return relative(sessionRoot, absolutePath).replaceAll("\\", "/");
}

export class VideoDemoJob {
  constructor({ manifest, manifestPath, sessionRoot, inputPath, runtime }) {
    this.manifest = manifest;
    this.manifestPath = manifestPath;
    this.sessionRoot = sessionRoot;
    this.inputPath = inputPath;
    this.runtime = runtime;
  }

  manifest;
  manifestPath;
  sessionRoot;
  inputPath;
  runtime;
  writeQueue = Promise.resolve();

  save(patch = {}) {
    const operation = this.writeQueue.then(async () => {
      this.manifest = {
        ...this.manifest,
        ...patch,
        updatedTime: Date.now(),
      };
      await writeJsonAtomically(this.manifestPath, this.manifest);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async run(signal) {
    try {
      await this.prepareDirectories();
      const restored = await this.restorePreparedGeneration();
      let generation = restored;
      if (!generation) {
        const { durationMs, source } = await this.transcribe(signal);
        const separation = await this.separateAudio(signal);
        const translation = await this.translate(source, signal);
        const reference = await this.extractReference(
          source,
          join(this.sessionRoot, separation.vocalsFile),
          signal,
        );
        const translatedCues = source.cues.map((cue, index) => ({
          ...cue,
          text: translation.cues[index].text,
          sourceText: cue.text,
        }));
        const targetCues = createDubbingPhrases(
          translatedCues,
          translation.targetLanguage,
        );
        const targetPath = join(this.sessionRoot, "target-cues.json");
        await writeJsonAtomically(targetPath, {
          plannerVersion: DUBBING_PHRASE_PLANNER_VERSION,
          durationMs,
          sourceLanguage: translation.sourceLanguage,
          targetLanguage: translation.targetLanguage,
          directionLabel: translation.directionLabel,
          cues: targetCues,
        });
        const probe = selectRightEdgeProbeCue(targetCues);
        await this.save({
          phase: "generating",
          tracks: {
            sourceFile: "source-track.json",
            translationFile: "translation-track.json",
            targetCuesFile: "target-cues.json",
          },
          translation: {
            sourceLanguage: translation.sourceLanguage,
            targetLanguage: translation.targetLanguage,
            directionLabel: translation.directionLabel,
          },
          separation,
          reference,
          probeCueId: probe.id,
          models: Object.fromEntries(
            VIDEO_DEMO_MODELS.map((model) => [
              model.id,
              {
                id: model.id,
                label: model.label,
                status: "queued",
                completedCues: 0,
                totalCues: targetCues.length,
                continuousSuffixStartMs: durationMs,
                audioFiles: {},
              },
            ]),
          ),
        });
        generation = { durationMs, targetCues, probe };
      } else {
        await this.save({
          phase: "generating",
          message: "已恢复上次完成的配音片段，继续生成剩余内容。",
          models: Object.fromEntries(
            VIDEO_DEMO_MODELS.map((model) => [
              model.id,
              this.manifest.models?.[model.id] ?? {
                id: model.id,
                label: model.label,
                status: "queued",
                completedCues: 0,
                totalCues: generation.targetCues.length,
                continuousSuffixStartMs: generation.durationMs,
                audioFiles: {},
              },
            ]),
          ),
        });
      }

      const { durationMs, targetCues, probe } = generation;

      for (const model of VIDEO_DEMO_MODELS) {
        signal.throwIfAborted();
        try {
          await this.runModel(model, targetCues, probe, durationMs, signal);
        } catch (error) {
          if (signal.aborted) throw error;
          await this.patchModel(model.id, {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const failures = Object.values(this.manifest.models).filter(
        ({ status }) => status === "failed",
      ).length;
      await this.save({
        phase: "completed",
        message:
          failures > 0
            ? `${failures} 个模型未完成，其余结果仍可体验。`
            : undefined,
      });
    } catch (error) {
      if (signal.aborted) {
        await this.save({ phase: "cancelled", message: "任务已取消。" });
        return;
      }
      await this.save({
        phase: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await this.cleanupTemporaryRuntime();
    }
  }

  async restorePreparedGeneration() {
    const targetCuesFile = this.manifest.tracks?.targetCuesFile;
    if (
      !targetCuesFile ||
      !this.manifest.reference?.file ||
      !this.manifest.separation?.vocalsFile ||
      !this.manifest.separation?.backgroundFile
    ) {
      return undefined;
    }
    try {
      const targetPath = join(this.sessionRoot, targetCuesFile);
      const payload = JSON.parse(await readFile(targetPath, "utf8"));
      if (
        payload.plannerVersion !== DUBBING_PHRASE_PLANNER_VERSION ||
        !Number.isSafeInteger(payload.durationMs) ||
        payload.durationMs <= 0 ||
        !Array.isArray(payload.cues) ||
        payload.cues.length === 0
      ) {
        return undefined;
      }
      const probe =
        payload.cues.find(({ id }) => id === this.manifest.probeCueId) ??
        selectRightEdgeProbeCue(payload.cues);
      return {
        durationMs: payload.durationMs,
        targetCues: payload.cues,
        probe,
      };
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async cleanupTemporaryRuntime() {
    const temporary = this.runtime.env.TEMP;
    if (
      typeof temporary !== "string" ||
      !/^[A-Za-z]:\\lc-voice-rendezvous-temp$/u.test(temporary)
    ) {
      return;
    }
    await rm(temporary, { recursive: true, force: true });
  }

  async prepareDirectories() {
    const environmentDirectories = [
      "PIP_CACHE_DIR",
      "HF_HOME",
      "HF_HUB_CACHE",
      "HF_ASSETS_CACHE",
      "TORCH_HOME",
      "TORCH_EXTENSIONS_DIR",
      "TORCHINDUCTOR_CACHE_DIR",
      "TRITON_CACHE_DIR",
      "CUDA_CACHE_PATH",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "NUMBA_CACHE_DIR",
      "MODELSCOPE_CACHE",
      "CACHED_PATH_CACHE_ROOT",
      "MPLCONFIGDIR",
      "GRADIO_TEMP_DIR",
      "WANDB_DIR",
      "WANDB_CACHE_DIR",
      "WANDB_CONFIG_DIR",
      "UV_CACHE_DIR",
      "PYTHONPYCACHEPREFIX",
      "TEMP",
    ].flatMap((key) => {
      const value = this.runtime.env[key];
      return typeof value === "string" && value ? [value] : [];
    });
    const directories = [
      this.sessionRoot,
      join(this.sessionRoot, "audio"),
      join(this.sessionRoot, "stems"),
      ...environmentDirectories,
    ];
    await Promise.all(
      directories.map((directory) => mkdir(directory, { recursive: true })),
    );
  }

  async transcribe(signal) {
    await this.save({ phase: "transcribing", message: undefined });
    const normalizedAudio = join(this.sessionRoot, "source.wav");
    await runCommand({
      command: this.runtime.subtitle.ffmpeg,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        this.inputPath,
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        normalizedAudio,
      ],
      env: this.runtime.env,
      signal,
    });
    const probe = await runCommand({
      command: this.runtime.subtitle.ffprobe,
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        this.inputPath,
      ],
      env: this.runtime.env,
      signal,
    });
    const durationMs = Math.round(
      Number.parseFloat(probe.stdout.trim()) * 1_000,
    );
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      throw new Error("无法读取视频时长");
    }

    const outputPrefix = join(this.sessionRoot, "whisper");
    await runCommand({
      command: this.runtime.subtitle.whisper,
      args: [
        "-m",
        this.runtime.subtitle.whisperModel,
        "-f",
        normalizedAudio,
        "-l",
        "auto",
        "-t",
        String(
          Math.max(
            4,
            Math.floor((globalThis.navigator?.hardwareConcurrency ?? 12) / 2),
          ),
        ),
        "-nfa",
        "-dtw",
        "large.v3.turbo",
        "-ml",
        "56",
        "-sow",
        "-ojf",
        "-of",
        outputPrefix,
      ],
      env: this.runtime.env,
      signal,
    });
    const source = parseWhisperSegments(
      JSON.parse(await readFile(`${outputPrefix}.json`, "utf8")),
      `demo:${this.manifest.id}:${this.manifest.uploadedTime}`,
    );
    await writeJsonAtomically(
      join(this.sessionRoot, "source-track.json"),
      source,
    );
    await this.save({
      phase: "source-ready",
      video: {
        ...this.manifest.video,
        durationMs,
      },
      subtitleProgress: {
        completed: source.cues.length,
        total: source.cues.length,
      },
    });
    return { durationMs, source };
  }

  async translate(source, signal) {
    await this.save({
      phase: "translating",
      subtitleProgress: { completed: 0, total: source.cues.length },
    });
    const translation = await translateTrackWithCodex({
      source,
      runtime: this.runtime,
      sessionRoot: this.sessionRoot,
      signal,
      execute: runCommand,
      onProgress: async (completed, total) => {
        await this.save({ subtitleProgress: { completed, total } });
      },
    });
    await writeJsonAtomically(
      join(this.sessionRoot, "translation-track.json"),
      translation,
    );
    return translation;
  }

  async separateAudio(signal) {
    await this.save({ phase: "separating-audio" });
    const stemsRoot = join(this.sessionRoot, "stems");
    const originalMix = join(stemsRoot, "original.wav");
    await runCommand({
      command: this.runtime.subtitle.ffmpeg,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        this.inputPath,
        "-vn",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        originalMix,
      ],
      env: this.runtime.env,
      signal,
    });
    await runCommand({
      command: this.runtime.sourceSeparation.python,
      args: [
        this.runtime.sourceSeparation.worker,
        "--input",
        originalMix,
        "--model",
        this.runtime.sourceSeparation.model,
        "--output",
        stemsRoot,
        "--provider",
        this.runtime.sourceSeparation.provider,
        "--threads",
        "2",
      ],
      env: this.runtime.env,
      signal,
    });
    const report = JSON.parse(
      await readFile(join(stemsRoot, "report.json"), "utf8"),
    );
    const separation = {
      model: report.model,
      provider: report.provider,
      vocalsFile: "stems/vocals.wav",
      backgroundFile: "stems/background.wav",
      elapsedSeconds: report.elapsedSeconds,
      rtf: report.rtf,
    };
    await rm(originalMix, { force: true });
    await this.save({ separation });
    return separation;
  }

  async extractReference(source, vocalsPath, signal) {
    await this.save({ phase: "extracting-reference" });
    const window = selectReferenceWindow(source.cues);
    const referencePath = join(this.sessionRoot, "reference.wav");
    await runCommand({
      command: this.runtime.subtitle.ffmpeg,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        (window.startMs / 1_000).toFixed(3),
        "-t",
        ((window.endMs - window.startMs) / 1_000).toFixed(3),
        "-i",
        vocalsPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        referencePath,
      ],
      env: this.runtime.env,
      signal,
    });
    await writeFile(
      join(this.sessionRoot, "reference.txt"),
      `${window.text}\n`,
      "utf8",
    );
    return {
      file: publicPath(this.sessionRoot, referencePath),
      transcriptFile: "reference.txt",
      startMs: window.startMs,
      endMs: window.endMs,
      sourceCueIds: window.sourceCueIds,
      source: "separated-vocals",
      text: window.text,
    };
  }

  async patchModel(modelId, patch) {
    await this.save({
      models: {
        ...this.manifest.models,
        [modelId]: {
          ...this.manifest.models[modelId],
          ...patch,
        },
      },
    });
  }

  async runModel(model, targetCues, probe, durationMs, signal) {
    const output = join(this.sessionRoot, "audio", model.id);
    await mkdir(output, { recursive: true });
    const previous = this.manifest.models[model.id];
    const audioFiles = mergeCompletedModelAudioFiles(
      model.id,
      targetCues,
      previous.audioFiles,
      await readdir(output),
    );
    const completed = new Set(Object.keys(audioFiles));
    const samples = Number.isFinite(previous.rollingTimelineRtf)
      ? [previous.rollingTimelineRtf]
      : [];
    const ordered = createReverseSuffixOrder(targetCues, probe.id).filter(
      ({ id }) => !completed.has(id),
    );
    if (ordered.length === 0) {
      await this.patchModel(model.id, {
        status: "ready",
        completedCues: completed.size,
        totalCues: targetCues.length,
        continuousSuffixStartMs: contiguousSuffixStartMs(
          targetCues,
          completed,
          durationMs,
        ),
        audioFiles,
        message: undefined,
      });
      return;
    }
    await this.patchModel(model.id, {
      status: "loading",
      completedCues: completed.size,
      totalCues: targetCues.length,
      continuousSuffixStartMs: contiguousSuffixStartMs(
        targetCues,
        completed,
        durationMs,
      ),
      audioFiles,
      message: undefined,
    });
    const orderPath = join(this.sessionRoot, `target-cues.${model.id}.json`);
    await writeJsonAtomically(orderPath, { durationMs, cues: ordered });

    let eventQueue = Promise.resolve();
    await runCommand({
      command: this.runtime.python,
      args: [
        join(this.runtime.demoRoot, "src", "video_voice_model_worker.py"),
        "--model-id",
        model.id,
        "--models",
        this.runtime.modelsRoot,
        "--reference",
        join(this.sessionRoot, "reference.wav"),
        "--reference-text",
        join(this.sessionRoot, "reference.txt"),
        "--cues",
        orderPath,
        "--output",
        output,
        "--ffmpeg",
        this.runtime.subtitle.ffmpeg,
      ],
      cwd: this.runtime.demoRoot,
      env: this.runtime.env,
      signal,
      onStdoutLine: (line) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        eventQueue = eventQueue.then(() =>
          this.handleModelEvent(
            model.id,
            event,
            targetCues,
            durationMs,
            completed,
            samples,
            audioFiles,
          ),
        );
      },
    });
    await eventQueue;
    await this.patchModel(model.id, {
      ...this.manifest.models[model.id],
      status: "ready",
      completedCues: completed.size,
      continuousSuffixStartMs: contiguousSuffixStartMs(
        targetCues,
        completed,
        durationMs,
      ),
      audioFiles: { ...audioFiles },
    });
  }

  async handleModelEvent(
    modelId,
    event,
    targetCues,
    durationMs,
    completed,
    samples,
    audioFiles,
  ) {
    if (event.type === "model-loaded") {
      await this.patchModel(modelId, {
        status: "probing",
        loadSeconds: event.loadSeconds,
        peakCudaMemoryBytes: event.peakCudaMemoryBytes,
      });
      return;
    }
    if (event.type !== "cue-complete") return;
    const cue = targetCues.find(({ id }) => id === event.cueId);
    if (!cue) return;
    completed.add(cue.id);
    samples.push(event.timelineRtf);
    audioFiles[cue.id] = `audio/${modelId}/${event.file}`;
    const currentRtf = rollingTimelineRtf(samples);
    const suffixStart = contiguousSuffixStartMs(
      targetCues,
      completed,
      durationMs,
    );
    const prediction = predictAdaptiveRendezvous({
      durationMs,
      generatedSuffixStartMs: suffixStart,
      rtf: currentRtf,
    });
    const previous = this.manifest.models[modelId];
    const probeResult =
      previous.probe ??
      (cue.id === this.manifest.probeCueId
        ? {
            cueId: cue.id,
            generationSeconds: event.generationSeconds,
            rawOutputSeconds: event.rawOutputSeconds,
            timelineRtf: event.timelineRtf,
            rawRtf: event.rawRtf,
            firstChunkSeconds: event.firstChunkSeconds,
          }
        : undefined);
    await this.patchModel(modelId, {
      status: "generating",
      completedCues: completed.size,
      totalCues: targetCues.length,
      continuousSuffixStartMs: suffixStart,
      rollingTimelineRtf: currentRtf,
      strategy: describeAdaptiveSuffixStrategy(currentRtf),
      prediction,
      probe: probeResult,
      audioFiles: { ...audioFiles },
      lastCue: {
        cueId: cue.id,
        generationSeconds: event.generationSeconds,
        timelineRtf: event.timelineRtf,
      },
      peakCudaMemoryBytes: Math.max(
        previous.peakCudaMemoryBytes ?? 0,
        event.peakCudaMemoryBytes ?? 0,
      ),
    });
  }
}
