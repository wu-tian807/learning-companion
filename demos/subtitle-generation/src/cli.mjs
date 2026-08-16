#!/usr/bin/env node
import console from 'node:console';
import { cpus, platform, release, totalmem } from 'node:os';
import { basename, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import {
  DEMO_ROOT,
  WHISPER_VERSION,
  normalizeMedia,
  probeDurationMs,
  resolveFfmpegTools,
  resolveWhisperInstallation,
  runProcess,
  runWhisper,
  sha256File,
} from './runtime.mjs';
import {
  canonicalCuesFromWhisper,
  measureAccuracy,
  toSrt,
  toVtt,
  validateTranscript,
} from './transcript.mjs';

function usage() {
  return `
Usage:
  node src/cli.mjs transcribe --input <media> [options]

Options:
  --backend <cpu|cuda>       Runtime backend (default: cpu)
  --model <name>             Default: base on CPU, large-v3-turbo-q5_0 on CUDA
  --language <code|auto>     Spoken language (default: auto)
  --output <directory>       Output directory (default: output/latest)
  --threads <number>         CPU worker threads
  --reference-id <id>        Compare with fixtures/references.json
  --no-vad                   Disable Silero VAD
`;
}

function parseArguments(argv) {
  if (argv[0] !== 'transcribe') throw new Error(usage());
  const result = { backend: 'cpu', language: 'auto', useVad: true };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-vad') {
      result.useVad = false;
      continue;
    }
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}\n${usage()}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
    index += 1;
    result[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!result.input) throw new Error(`--input is required.\n${usage()}`);
  if (!['cpu', 'cuda'].includes(result.backend)) throw new Error('--backend must be cpu or cuda.');
  result.model ??= result.backend === 'cuda' ? 'large-v3-turbo-q5_0' : 'base';
  result.output ??= resolve(DEMO_ROOT, 'output', 'latest');
  result.threads = result.threads ? Number(result.threads) : Math.max(4, Math.floor(cpus().length / 2));
  if (!Number.isInteger(result.threads) || result.threads < 1) throw new Error('--threads must be a positive integer.');
  return result;
}

async function loadReference(referenceId) {
  if (!referenceId) return undefined;
  const references = JSON.parse(await readFile(resolve(DEMO_ROOT, 'fixtures', 'references.json'), 'utf8'));
  const reference = references.find((candidate) => candidate.id === referenceId);
  if (!reference) throw new Error(`Unknown reference id: ${referenceId}`);
  return reference;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPath = resolve(options.input);
  const outputDirectory = resolve(options.output);
  const overallStartedAt = performance.now();
  await mkdir(outputDirectory, { recursive: true });

  const { ffmpeg, ffprobe } = resolveFfmpegTools();
  const installation = await resolveWhisperInstallation(options.backend, options.model);
  const [sourceHash, sourceDurationMs, engineVersion] = await Promise.all([
    sha256File(inputPath),
    probeDurationMs(inputPath, ffprobe),
    runProcess(installation.executable, ['--version']).then((result) => result.stdout.trim()),
  ]);
  const normalized = await normalizeMedia(inputPath, ffmpeg, sourceHash);

  console.log(`Transcribing ${basename(inputPath)} with ${options.model} (${options.backend})`);
  const whisper = await runWhisper({
    installation,
    backend: options.backend,
    language: options.language,
    normalizedPath: normalized.normalizedPath,
    outputDirectory,
    threads: options.threads,
    useVad: options.useVad,
    onCue(event) {
      const seconds = (event.emittedAfterMs / 1_000).toFixed(2);
      console.log(`[+${seconds}s] ${event.cue.text}`);
    },
  });

  const cues = canonicalCuesFromWhisper(whisper.rawJson);
  const detectedLanguage = whisper.rawJson?.result?.language ?? options.language;
  const reference = await loadReference(options.referenceId);
  const hypothesis = cues.map((cue) => cue.text).join(' ');
  const accuracy = reference ? measureAccuracy(reference.text, hypothesis, reference.language) : undefined;
  const endToEndMs = performance.now() - overallStartedAt;
  const metrics = {
    sourceDurationMs,
    normalizationMs: Math.round(normalized.durationMs),
    normalizationCacheHit: normalized.cacheHit,
    transcriptionMs: Math.round(whisper.durationMs),
    firstCueMs: whisper.firstCueMs === null ? null : Math.round(whisper.firstCueMs),
    firstSubtitleEndToEndMs: whisper.firstCueMs === null ? null : Math.round(normalized.durationMs + whisper.firstCueMs),
    endToEndMs: Math.round(endToEndMs),
    realTimeFactor: sourceDurationMs === 0 ? null : whisper.durationMs / sourceDurationMs,
    emittedCueCount: whisper.emittedCueCount,
    finalCueCount: cues.length,
    accuracy,
  };
  const transcript = validateTranscript({
    schemaVersion: 1,
    artifactType: 'media.transcript.v1',
    source: {
      filename: basename(inputPath),
      sha256: sourceHash,
      durationMs: sourceDurationMs,
    },
    engine: {
      id: 'whisper.cpp',
      version: engineVersion || WHISPER_VERSION,
      backend: options.backend,
      model: options.model,
      languageRequested: options.language,
      languageDetected: detectedLanguage,
      vad: options.useVad,
      threads: options.threads,
    },
    generatedAt: new Date().toISOString(),
    cues,
    metrics,
  });

  const benchmark = {
    schemaVersion: 1,
    measuredAt: transcript.generatedAt,
    host: {
      platform: platform(),
      release: release(),
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    source: transcript.source,
    engine: transcript.engine,
    metrics,
  };

  await Promise.all([
    writeFile(resolve(outputDirectory, 'transcript.json'), `${JSON.stringify(transcript, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outputDirectory, 'subtitles.srt'), toSrt(cues), 'utf8'),
    writeFile(resolve(outputDirectory, 'subtitles.vtt'), toVtt(cues), 'utf8'),
    writeFile(resolve(outputDirectory, 'benchmark.json'), `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outputDirectory, 'whisper.stderr.log'), whisper.stderr, 'utf8'),
  ]);

  console.log(`Completed: ${outputDirectory}`);
  console.log(`First cue: ${metrics.firstCueMs ?? 'n/a'} ms; RTF: ${metrics.realTimeFactor?.toFixed(3) ?? 'n/a'}; cues: ${cues.length}`);
  if (accuracy) console.log(`${accuracy.metric.toUpperCase()}: ${(accuracy.rate * 100).toFixed(2)}%`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
