import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createHyMt2CuePrompt, parseHyMt2CueResponse } from './hymt2-format.mjs';
import {
  readNvidiaProcessMemoryBytes,
  readProcessWorkingSetBytes,
  startHyMt2Server,
} from './hymt2-runtime.mjs';
import { prepareCuesForTranslation } from './prepare-cues.mjs';
import { parseSrt, toSrt } from './srt.mjs';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIRECTORY = resolve(SOURCE_DIRECTORY, '..', 'results', 'hymt2-single');

function percentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1)];
}

export async function runHyMt2Benchmark({
  inputPath,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  from,
  to,
  backend = 'vulkan',
  preprocess = true,
  concurrency = 4,
}) {
  if (!inputPath || !from || !to) throw new Error('inputPath, from and to are required.');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer.');
  const input = await readFile(inputPath, 'utf8');
  const inputCues = parseSrt(input);
  if (inputCues.length === 0) throw new Error('The source subtitle has no cues.');
  const cues = preprocess ? prepareCuesForTranslation(inputCues, from) : inputCues;
  await mkdir(outputDirectory, { recursive: true });

  const server = await startHyMt2Server({ backend, parallel: concurrency });
  let peakServerRssBytes = (await readProcessWorkingSetBytes(server.child.pid)) ?? 0;
  let memorySampleInFlight = false;
  const sampleMemory = async () => {
    if (memorySampleInFlight) return;
    memorySampleInFlight = true;
    try {
      const workingSet = await readProcessWorkingSetBytes(server.child.pid);
      if (workingSet !== null) peakServerRssBytes = Math.max(peakServerRssBytes, workingSet);
    } finally {
      memorySampleInFlight = false;
    }
  };
  const serverRssAfterLoadBytes = peakServerRssBytes;
  const memoryTimer = setInterval(sampleMemory, 100);
  let peakGpuMemoryBytes = (await readNvidiaProcessMemoryBytes(server.child.pid)) ?? 0;
  let gpuSampleInFlight = false;
  const sampleGpuMemory = async () => {
    if (gpuSampleInFlight) return;
    gpuSampleInFlight = true;
    try {
      const memory = await readNvidiaProcessMemoryBytes(server.child.pid);
      if (memory !== null) peakGpuMemoryBytes = Math.max(peakGpuMemoryBytes, memory);
    } finally {
      gpuSampleInFlight = false;
    }
  };
  const gpuMemoryAfterLoadBytes = peakGpuMemoryBytes;
  const gpuTimer = setInterval(sampleGpuMemory, 1_000);

  try {
    const translatedCues = new Array(cues.length);
    const events = [];
    const latencies = [];
    let promptTokens = 0;
    let completionTokens = 0;
    let nextCueIndex = 0;
    const bulkStartedAt = performance.now();

    const worker = async (workerIndex) => {
      while (nextCueIndex < cues.length) {
        const cueIndex = nextCueIndex;
        nextCueIndex += 1;
        const cue = cues[cueIndex];
        const queuedAt = performance.now();
        const completion = await server.complete(createHyMt2CuePrompt(cues, cueIndex, from, to), {
          maxTokens: Math.min(512, Math.max(64, cue.text.length * 3)),
        });
        const completedAt = performance.now();
        const translatedText = parseHyMt2CueResponse(completion.text);
        translatedCues[cueIndex] = { ...cue, translatedText };
        const latencyMs = completedAt - queuedAt;
        latencies.push(latencyMs);
        promptTokens += completion.usage?.prompt_tokens ?? 0;
        completionTokens += completion.usage?.completion_tokens ?? 0;
        events.push({
          type: 'translation.cue.final',
          cueId: cue.id,
          workerIndex,
          queuedMs: queuedAt - bulkStartedAt,
          completedMs: completedAt - bulkStartedAt,
          latencyMs,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, cues.length) }, (_, index) => worker(index)));
    const bulkTranslationMs = performance.now() - bulkStartedAt;
    await sampleMemory();
    await sampleGpuMemory();
    const orderedEvents = events.sort((left, right) => left.completedMs - right.completedMs);
    const mediaDurationMs = Math.max(...cues.map((cue) => cue.endMs));
    const sourceCharacters = cues.reduce((total, cue) => total + cue.text.length, 0);
    const benchmark = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      engine: 'hymt2-1.8b-q4-llama.cpp',
      modelPair: `${from}-${to}`,
      inputPath: resolve(inputPath),
      configuration: { from, to, backend, preprocess, concurrency, contextCues: 3 },
      metrics: {
        inputCueCount: inputCues.length,
        cueCount: cues.length,
        sourceCharacters,
        mediaDurationMs,
        modelLoadMs: server.modelLoadMs,
        firstCueMs: orderedEvents[0]?.completedMs ?? null,
        cueLatency: {
          p50Ms: percentile(latencies, 0.5),
          p95Ms: percentile(latencies, 0.95),
          maxMs: latencies.length > 0 ? Math.max(...latencies) : null,
        },
        timeToFirstTranslatedCueMs: server.modelLoadMs + (orderedEvents[0]?.completedMs ?? 0),
        bulkTranslationMs,
        endToEndMs: server.modelLoadMs + bulkTranslationMs,
        mediaToTranslationRatio: mediaDurationMs / bulkTranslationMs,
        promptTokens,
        completionTokens,
        serverRssAfterLoadBytes,
        peakServerRssBytes,
        gpuMemoryAfterLoadBytes,
        peakGpuMemoryBytes,
      },
    };
    const translationRecord = {
      schemaVersion: 1,
      artifactType: 'media.translation.v1-candidate',
      sourceLanguage: from,
      targetLanguage: to,
      cues: translatedCues.map((cue) => ({
        id: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        sourceText: cue.text,
        translatedText: cue.translatedText,
        sourceCueIds: cue.sourceCueIds ?? [cue.id],
      })),
    };

    await Promise.all([
      writeFile(resolve(outputDirectory, 'source.srt'), toSrt(translatedCues), 'utf8'),
      writeFile(
        resolve(outputDirectory, 'translated.srt'),
        toSrt(translatedCues, (cue) => cue.translatedText),
        'utf8',
      ),
      writeFile(
        resolve(outputDirectory, 'bilingual.srt'),
        toSrt(translatedCues, (cue) => `${cue.text}\n${cue.translatedText}`),
        'utf8',
      ),
      writeFile(resolve(outputDirectory, 'translation.json'), `${JSON.stringify(translationRecord, null, 2)}\n`, 'utf8'),
      writeFile(resolve(outputDirectory, 'benchmark.json'), `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8'),
      writeFile(resolve(outputDirectory, 'events.ndjson'), `${orderedEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8'),
      writeFile(resolve(outputDirectory, 'server.log'), server.getLogs(), 'utf8'),
    ]);
    return { benchmark, translatedCues };
  } finally {
    clearInterval(memoryTimer);
    clearInterval(gpuTimer);
    await server.stop();
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    options[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const result = await runHyMt2Benchmark({
    inputPath: args.input,
    outputDirectory: args.output ? resolve(args.output) : DEFAULT_OUTPUT_DIRECTORY,
    from: args.from,
    to: args.to,
    backend: args.backend ?? 'vulkan',
    concurrency: args.concurrency ? Number(args.concurrency) : 4,
  });
  console.log(JSON.stringify(result.benchmark.metrics, null, 2));
}
