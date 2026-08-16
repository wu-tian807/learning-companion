import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { parseWhisperCueLine } from './transcript.mjs';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const DEMO_ROOT = resolve(SOURCE_DIRECTORY, '..');
export const WHISPER_VERSION = 'v1.9.2';

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  const input = createReadStream(filePath);
  input.on('data', (chunk) => hash.update(chunk));
  await finished(input);
  return hash.digest('hex');
}

function commandOnPath(command) {
  const lookup = process.platform === 'win32' ? spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true }) : spawnSync('which', [command], { encoding: 'utf8' });
  if (lookup.status !== 0) return undefined;
  return lookup.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
}

export function resolveFfmpegTools() {
  const ffmpeg = process.env.FFMPEG_PATH || commandOnPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (!ffmpeg) throw new Error('FFmpeg was not found. Add ffmpeg to PATH or set FFMPEG_PATH.');
  const adjacentProbe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const ffprobe = process.env.FFPROBE_PATH || commandOnPath(process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') || adjacentProbe;
  return { ffmpeg, ffprobe };
}

async function findFile(directory, fileName) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = join(directory, entry.name);
    if (entry.isFile() && entry.name.toLocaleLowerCase() === fileName.toLocaleLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, fileName);
      if (nested) return nested;
    }
  }
  return undefined;
}

export async function resolveWhisperInstallation(backend, model) {
  const runtimeDirectory = join(DEMO_ROOT, '.runtime', 'whisper.cpp', WHISPER_VERSION, backend);
  const executableName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const executable = await findFile(runtimeDirectory, executableName).catch(() => undefined);
  const modelPath = join(DEMO_ROOT, '.models', `ggml-${model}.bin`);
  const vadModelPath = join(DEMO_ROOT, '.models', 'ggml-silero-v6.2.0.bin');

  if (!executable) throw new Error(`whisper.cpp ${backend} runtime is missing. Run pnpm setup:${backend}.`);
  await stat(modelPath).catch(() => {
    throw new Error(`Whisper model is missing: ${modelPath}`);
  });
  return { executable, modelPath, vadModelPath };
}

export function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = performance.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => {
      const result = {
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationMs: performance.now() - startedAt,
      };
      if (exitCode !== 0) {
        reject(new Error(`${command} exited with code ${exitCode}.\n${result.stderr || result.stdout}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

export async function probeDurationMs(filePath, ffprobe) {
  const result = await runProcess(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
  const seconds = Number(result.stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe returned an invalid duration for ${filePath}.`);
  return Math.round(seconds * 1_000);
}

export async function normalizeMedia(inputPath, ffmpeg, sourceHash) {
  const cacheDirectory = join(DEMO_ROOT, '.cache', 'normalized');
  const normalizedPath = join(cacheDirectory, `${sourceHash}.pcm16-16khz-mono.wav`);
  const stagingPath = `${normalizedPath}.${process.pid}.tmp.wav`;
  await mkdir(cacheDirectory, { recursive: true });
  try {
    await stat(normalizedPath);
    return { normalizedPath, durationMs: 0, cacheHit: true };
  } catch {
    try {
      const result = await runProcess(ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        stagingPath,
      ]);
      await rename(stagingPath, normalizedPath);
      return { normalizedPath, durationMs: result.durationMs, cacheHit: false };
    } finally {
      await rm(stagingPath, { force: true });
    }
  }
}

export async function runWhisper({ installation, backend, language, normalizedPath, outputDirectory, threads, useVad, onCue }) {
  await mkdir(outputDirectory, { recursive: true });
  if (useVad) {
    await stat(installation.vadModelPath).catch(() => {
      throw new Error(`Silero VAD model is missing: ${installation.vadModelPath}`);
    });
  }
  const outputPrefix = join(outputDirectory, 'whisper');
  const eventsPath = join(outputDirectory, 'events.ndjson');
  const eventStream = createWriteStream(eventsPath, { encoding: 'utf8' });
  const args = [
    '-m', installation.modelPath,
    '-f', normalizedPath,
    '-l', language,
    '-t', String(threads),
    '-fa',
    '-oj',
    '-of', outputPrefix,
  ];
  if (backend === 'cpu') args.push('-ng');
  if (useVad) args.push('--vad', '-vm', installation.vadModelPath);

  const startedAt = performance.now();
  const child = spawn(installation.executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdoutLines = [];
  const stderr = [];
  let firstCueMs = null;
  let cueIndex = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    stdoutLines.push(line);
    const parsed = parseWhisperCueLine(line);
    if (!parsed || parsed.text.length === 0) return;
    cueIndex += 1;
    const emittedAfterMs = performance.now() - startedAt;
    if (firstCueMs === null) firstCueMs = emittedAfterMs;
    const event = {
      type: 'cue.final',
      emittedAfterMs: Math.round(emittedAfterMs),
      cue: { id: `cue-${String(cueIndex).padStart(6, '0')}`, ...parsed, state: 'final' },
    };
    eventStream.write(`${JSON.stringify(event)}\n`);
    onCue?.(event);
  });
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  const exitCode = await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', resolvePromise);
  });
  lines.close();
  eventStream.end();
  await finished(eventStream);

  const durationMs = performance.now() - startedAt;
  const stderrText = Buffer.concat(stderr).toString('utf8');
  if (exitCode !== 0) throw new Error(`whisper.cpp exited with code ${exitCode}.\n${stderrText}`);

  const rawJsonPath = `${outputPrefix}.json`;
  const rawJson = JSON.parse(await readFile(rawJsonPath, 'utf8'));
  return {
    rawJson,
    rawJsonPath,
    stdout: stdoutLines.join('\n'),
    stderr: stderrText,
    durationMs,
    firstCueMs,
    emittedCueCount: cueIndex,
  };
}
