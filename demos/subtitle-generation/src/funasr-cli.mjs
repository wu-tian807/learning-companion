#!/usr/bin/env node
import console from 'node:console';
import { cpus, platform, release, totalmem } from 'node:os';
import { basename, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import {
  DEMO_ROOT,
  normalizeMedia,
  probeDurationMs,
  resolveFfmpegTools,
  sha256File,
} from './runtime.mjs';
import {
  FUNASR_RUNTIME_VERSION,
  PARAFORMER_MODEL,
  SENSEVOICE_MODEL,
  resolveParaformerInstallation,
  resolveSenseVoiceInstallation,
  runParaformer,
  runSenseVoice,
} from './funasr-runtime.mjs';
import { toSrt, toVtt, validateTranscript } from './transcript.mjs';

function usage() {
  return `
Usage:
  node src/funasr-cli.mjs transcribe --engine <sensevoice|paraformer> --input <media> [options]

Options:
  --output <directory>          Output directory (default: output/<engine>-latest)
  --max-cue-characters <count>  Readability split size (default: 28 / 22)
`;
}

function parseArguments(argv) {
  if (argv[0] !== 'transcribe') throw new Error(usage());
  const result = {};
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}\n${usage()}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
    index += 1;
    result[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!result.input) throw new Error(`--input is required.\n${usage()}`);
  if (!['sensevoice', 'paraformer'].includes(result.engine)) {
    throw new Error(`--engine must be sensevoice or paraformer.\n${usage()}`);
  }
  result.output ??= resolve(DEMO_ROOT, 'output', `${result.engine}-latest`);
  result.maxCueCharacters = result.maxCueCharacters
    ? Number(result.maxCueCharacters)
    : result.engine === 'paraformer' ? 22 : 28;
  if (!Number.isInteger(result.maxCueCharacters) || result.maxCueCharacters < 1) {
    throw new Error('--max-cue-characters must be a positive integer.');
  }
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPath = resolve(options.input);
  const outputDirectory = resolve(options.output);
  const overallStartedAt = performance.now();
  await mkdir(outputDirectory, { recursive: true });

  const { ffmpeg, ffprobe } = resolveFfmpegTools();
  const installation = options.engine === 'paraformer'
    ? await resolveParaformerInstallation()
    : await resolveSenseVoiceInstallation();
  const [sourceHash, sourceDurationMs] = await Promise.all([
    sha256File(inputPath),
    probeDurationMs(inputPath, ffprobe),
  ]);
  const normalized = await normalizeMedia(inputPath, ffmpeg, sourceHash);

  const model = options.engine === 'paraformer' ? PARAFORMER_MODEL : SENSEVOICE_MODEL;
  console.log(`Transcribing ${basename(inputPath)} with ${model} (CPU AVX2)`);
  const recognition = await (options.engine === 'paraformer' ? runParaformer : runSenseVoice)({
    installation,
    normalizedPath: normalized.normalizedPath,
    maximumCharacters: options.maxCueCharacters,
  });
  const detectedLanguages = options.engine === 'sensevoice'
    ? new Set(recognition.recognizedSegments.map((segment) => segment.language))
    : new Set(['zh']);
  const languageDetected = detectedLanguages.size === 1
    ? Array.from(detectedLanguages)[0]
    : 'mixed';
  const endToEndMs = performance.now() - overallStartedAt;
  const metrics = {
    sourceDurationMs,
    normalizationMs: Math.round(normalized.durationMs),
    normalizationCacheHit: normalized.cacheHit,
    transcriptionMs: Math.round(recognition.durationMs),
    firstCueMs: recognition.firstCueMs === null ? null : Math.round(recognition.firstCueMs),
    firstSubtitleEndToEndMs: recognition.firstCueMs === null
      ? null
      : Math.round(normalized.durationMs + recognition.firstCueMs),
    endToEndMs: Math.round(endToEndMs),
    realTimeFactor: sourceDurationMs === 0 ? null : recognition.durationMs / sourceDurationMs,
    emittedCueCount: recognition.cues.length,
    finalCueCount: recognition.cues.length,
  };
  const generatedAt = new Date().toISOString();
  const transcript = validateTranscript({
    schemaVersion: 1,
    artifactType: 'media.transcript.v1',
    source: {
      filename: basename(inputPath),
      sha256: sourceHash,
      durationMs: sourceDurationMs,
    },
    engine: {
      id: 'funasr-llama.cpp',
      version: FUNASR_RUNTIME_VERSION,
      backend: 'cpu-avx2',
      model,
      languageRequested: 'auto',
      languageDetected,
      vad: 'fsmn-vad',
      timingSource: options.engine === 'paraformer'
        ? 'fsmn-vad-global-proportional'
        : 'fsmn-vad-proportional',
      punctuation: options.engine === 'sensevoice' ? 'model' : 'none',
      streaming: false,
    },
    generatedAt,
    cues: recognition.cues,
    metrics,
  });
  const benchmark = {
    schemaVersion: 1,
    measuredAt: generatedAt,
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
  const emittedAfterMs = Math.round(recognition.durationMs);
  const events = recognition.cues.map((cue) => JSON.stringify({
    type: 'cue.final',
    emittedAfterMs,
    cue,
  })).join('\n');

  await Promise.all([
    writeFile(resolve(outputDirectory, 'transcript.json'), `${JSON.stringify(transcript, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outputDirectory, 'subtitles.srt'), toSrt(recognition.cues), 'utf8'),
    writeFile(resolve(outputDirectory, 'subtitles.vtt'), toVtt(recognition.cues), 'utf8'),
    writeFile(resolve(outputDirectory, 'benchmark.json'), `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outputDirectory, 'events.ndjson'), events ? `${events}\n` : '', 'utf8'),
    writeFile(resolve(outputDirectory, `${options.engine}.stdout.log`), recognition.stdout, 'utf8'),
    writeFile(resolve(outputDirectory, `${options.engine}.stderr.log`), recognition.stderr, 'utf8'),
    writeFile(resolve(outputDirectory, 'vad.stdout.log'), recognition.vadStdout, 'utf8'),
  ]);

  console.log(`Completed: ${outputDirectory}`);
  console.log(`First cue: ${metrics.firstCueMs ?? 'n/a'} ms; RTF: ${metrics.realTimeFactor?.toFixed(3) ?? 'n/a'}; cues: ${recognition.cues.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
