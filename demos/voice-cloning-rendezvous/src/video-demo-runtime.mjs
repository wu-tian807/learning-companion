import { createRequire } from "node:module";
import { homedir } from "node:os";
import { access, readFile, readdir } from "node:fs/promises";
import { delimiter, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const repositoryRoot = resolve(demoRoot, "../..");
const requireFromRepository = createRequire(
  join(repositoryRoot, "package.json"),
);

const REQUIRED_SUBTITLE_PATHS = Object.freeze({
  ffmpeg: "decoder/engine/ffmpeg-8.1.2-essentials_build/bin/ffmpeg.exe",
  ffprobe: "decoder/engine/ffmpeg-8.1.2-essentials_build/bin/ffprobe.exe",
  whisper: "transcription/whisper/engine/Release/whisper-cli.exe",
  whisperModel: "transcription/whisper/models/ggml-large-v3-turbo-q5_0.bin",
});

const REQUIRED_MODEL_DIRECTORIES = Object.freeze({
  voxcpm15: "VoxCPM1.5",
  voxcpm2: "VoxCPM2",
  f5tts: "F5-TTS",
  f5Vocoder: "vocos-mel-24khz",
});

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function externalLibraryRoot() {
  const configured = process.env.LC_EXTERNAL_LIBRARIES_PATH?.trim();
  if (configured) return resolve(configured);

  const appData = process.env.APPDATA?.trim();
  if (appData) {
    const settingsPath = join(
      appData,
      "Learning Companion",
      "config",
      "settings.json",
    );
    try {
      const settings = JSON.parse(await readFile(settingsPath, "utf8"));
      if (
        typeof settings.externalLibrariesPath === "string" &&
        settings.externalLibrariesPath.trim()
      ) {
        return resolve(settings.externalLibrariesPath);
      }
    } catch {
      // The standalone Demo remains usable before the desktop app has settings.
    }
  }

  return join(homedir(), "Documents", "Learning Companion", "externalLib");
}

async function latestSubtitleRuntime() {
  const libraryRoot = join(await externalLibraryRoot(), "media-subtitles");
  let versions;
  try {
    versions = (await readdir(libraryRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => name)
      .sort((left, right) => right.localeCompare(left));
  } catch {
    return undefined;
  }

  for (const version of versions) {
    const runtime = join(libraryRoot, version, "win32-x64", "runtime");
    const paths = Object.fromEntries(
      Object.entries(REQUIRED_SUBTITLE_PATHS).map(([key, relativePath]) => [
        key,
        join(runtime, ...relativePath.split("/")),
      ]),
    );
    if ((await Promise.all(Object.values(paths).map(exists))).every(Boolean)) {
      return Object.freeze({ root: runtime, version, ...paths });
    }
  }
  return undefined;
}

function runtimeEnvironment(torchLibraryPath, codexHomePath) {
  const runtimeRoot = join(demoRoot, ".runtime");
  const cacheRoot = join(runtimeRoot, "cache");
  const driveRoot = parse(demoRoot).root;
  const temporaryRoot = join(driveRoot, "lc-voice-rendezvous-temp");
  return {
    ...process.env,
    CODEX_HOME: codexHomePath,
    PATH: [torchLibraryPath, process.env.PATH].filter(Boolean).join(delimiter),
    PIP_CACHE_DIR: join(cacheRoot, "pip"),
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    HF_HOME: join(cacheRoot, "huggingface"),
    HF_HUB_CACHE: join(cacheRoot, "huggingface", "hub"),
    HF_ASSETS_CACHE: join(cacheRoot, "huggingface", "assets"),
    TORCH_HOME: join(cacheRoot, "torch"),
    TORCH_EXTENSIONS_DIR: join(cacheRoot, "torch-extensions"),
    TORCHINDUCTOR_CACHE_DIR: join(cacheRoot, "torch-inductor"),
    TRITON_CACHE_DIR: join(cacheRoot, "triton"),
    CUDA_CACHE_PATH: join(cacheRoot, "cuda"),
    XDG_CACHE_HOME: join(cacheRoot, "xdg"),
    XDG_CONFIG_HOME: join(cacheRoot, "xdg-config"),
    NUMBA_CACHE_DIR: join(cacheRoot, "numba"),
    MODELSCOPE_CACHE: join(cacheRoot, "modelscope"),
    CACHED_PATH_CACHE_ROOT: join(cacheRoot, "cached-path"),
    CACHED_PATH_CACHE_DIR: join(cacheRoot, "cached-path"),
    MPLCONFIGDIR: join(cacheRoot, "matplotlib"),
    GRADIO_TEMP_DIR: join(temporaryRoot, "gradio"),
    WANDB_DIR: join(cacheRoot, "wandb"),
    WANDB_CACHE_DIR: join(cacheRoot, "wandb", "cache"),
    WANDB_CONFIG_DIR: join(cacheRoot, "wandb", "config"),
    WANDB_MODE: "disabled",
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    TMPDIR: temporaryRoot,
    UV_CACHE_DIR: join(cacheRoot, "uv"),
    PYTHONPYCACHEPREFIX: join(cacheRoot, "pycache"),
    HF_HUB_DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
  };
}

async function resolveCodexRuntime() {
  const packageJson = requireFromRepository.resolve(
    "@openai/codex/package.json",
  );
  const packageMetadata = JSON.parse(await readFile(packageJson, "utf8"));
  const codexHome = resolve(
    process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
  );
  return Object.freeze({
    cli: join(dirname(packageJson), "bin", "codex.js"),
    home: codexHome,
    auth: join(codexHome, "auth.json"),
    outputSchema: join(
      demoRoot,
      "src",
      "subtitle-translation-output.schema.json",
    ),
    version: String(packageMetadata.version ?? "unknown"),
    model: process.env.LC_DEMO_TRANSLATION_MODEL?.trim() || "gpt-5.6-luna",
    reasoningEffort: process.env.LC_DEMO_TRANSLATION_REASONING?.trim() || "low",
  });
}

export async function resolveVideoDemoRuntime() {
  const python = join(demoRoot, ".runtime", "python", "Scripts", "python.exe");
  const torchLibraryPath = join(
    demoRoot,
    ".runtime",
    "python",
    "Lib",
    "site-packages",
    "torch",
    "lib",
  );
  const sourceSeparation = Object.freeze({
    python: join(
      demoRoot,
      ".runtime",
      "separation-python",
      "Scripts",
      "python.exe",
    ),
    worker: join(demoRoot, "src", "source_separation_worker.py"),
    model: join(
      demoRoot,
      ".models",
      "source-separation",
      "UVR-MDX-NET-Inst_HQ_4.onnx",
    ),
    provider: "cuda",
  });
  const modelsRoot = join(demoRoot, ".models");
  const subtitle = await latestSubtitleRuntime();
  const codex = await resolveCodexRuntime();
  const modelPaths = Object.fromEntries(
    Object.entries(REQUIRED_MODEL_DIRECTORIES).map(([key, directory]) => [
      key,
      join(modelsRoot, directory),
    ]),
  );
  const checks = {
    python: await exists(python),
    subtitle: Boolean(subtitle),
    codex: (
      await Promise.all([codex.cli, codex.auth, codex.outputSchema].map(exists))
    ).every(Boolean),
    voxcpm15: await exists(modelPaths.voxcpm15),
    voxcpm2: await exists(modelPaths.voxcpm2),
    f5tts:
      (await exists(modelPaths.f5tts)) && (await exists(modelPaths.f5Vocoder)),
    sourceSeparation: (
      await Promise.all(
        [
          sourceSeparation.python,
          sourceSeparation.worker,
          sourceSeparation.model,
          torchLibraryPath,
        ].map(exists),
      )
    ).every(Boolean),
  };

  return Object.freeze({
    ready: Object.values(checks).every(Boolean),
    checks: Object.freeze(checks),
    demoRoot,
    modelsRoot,
    python,
    sourceSeparation,
    subtitle,
    codex,
    env: Object.freeze(runtimeEnvironment(torchLibraryPath, codex.home)),
  });
}

export { demoRoot };
