import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createLocalBergamotTranslator } from './bergamot-runtime.mjs';
import { prepareCuesForTranslation } from './prepare-cues.mjs';
import { parseSrt, toSrt } from './srt.mjs';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIRECTORY = resolve(SOURCE_DIRECTORY, '..', 'results', 'single');

function percentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(probability * sorted.length) - 1));
  return sorted[index];
}

function summarize(values) {
  if (values.length === 0) return { count: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  return {
    count: values.length,
    minMs: Math.min(...values),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values),
  };
}

async function translateRequest(translator, { from, to, text }) {
  const response = await translator.translate({ from, to, text, html: false, qualityScores: false });
  return response.target.text.trim();
}

export async function runTranslationBenchmark({
  inputPath,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  from,
  to,
  batchSize = 8,
  workers = 1,
  warmSampleSize = 20,
  preprocess = true,
}) {
  if (!inputPath || !from || !to) throw new Error('inputPath, from and to are required.');
  const input = await readFile(inputPath, 'utf8');
  const inputCues = parseSrt(input);
  if (inputCues.length === 0) throw new Error('The source subtitle has no cues.');
  const cues = preprocess ? prepareCuesForTranslation(inputCues, from) : inputCues;
  await mkdir(outputDirectory, { recursive: true });

  const rssBeforeBytes = process.memoryUsage.rss();
  const translator = createLocalBergamotTranslator({ workers, batchSize, cacheSize: 0 });
  let peakRssBytes = rssBeforeBytes;
  const sampleMemory = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
  };

  try {
    const firstNonEmptyCue = cues.find((cue) => cue.text.length > 0);
    if (!firstNonEmptyCue) throw new Error('The source subtitle has no translatable text.');
    const coldStartedAt = performance.now();
    await translateRequest(translator, { from, to, text: firstNonEmptyCue.text });
    const coldFirstCueMs = performance.now() - coldStartedAt;
    sampleMemory();
    const rssAfterModelLoadBytes = process.memoryUsage.rss();

    const warmLatencies = [];
    for (const cue of cues.filter((candidate) => candidate.text.length > 0).slice(0, warmSampleSize)) {
      const startedAt = performance.now();
      await translateRequest(translator, { from, to, text: cue.text });
      warmLatencies.push(performance.now() - startedAt);
      sampleMemory();
    }

    const events = [];
    const bulkStartedAt = performance.now();
    const memoryTimer = setInterval(sampleMemory, 10);
    let translatedCues;
    try {
      translatedCues = await Promise.all(
        cues.map(async (cue, index) => {
          if (cue.text.length === 0) return { ...cue, translatedText: '' };
          const queuedAt = performance.now();
          const translatedText = await translateRequest(translator, { from, to, text: cue.text });
          const completedAt = performance.now();
          events.push({
            type: 'translation.cue.final',
            cueId: cue.id,
            sourceIndex: index,
            queuedMs: queuedAt - bulkStartedAt,
            completedMs: completedAt - bulkStartedAt,
            latencyMs: completedAt - queuedAt,
          });
          return { ...cue, translatedText };
        }),
      );
    } finally {
      clearInterval(memoryTimer);
    }
    sampleMemory();
    const bulkTranslationMs = performance.now() - bulkStartedAt;
    const orderedEvents = events.sort((left, right) => left.completedMs - right.completedMs);
    const mediaDurationMs = Math.max(...cues.map((cue) => cue.endMs));
    const sourceCharacters = cues.reduce((total, cue) => total + cue.text.length, 0);
    const benchmark = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      engine: 'bergamot-wasm',
      modelPair: `${from}-${to}`,
      inputPath: resolve(inputPath),
      configuration: { from, to, batchSize, workers, warmSampleSize, preprocess },
      metrics: {
        inputCueCount: inputCues.length,
        cueCount: cues.length,
        sourceCharacters,
        mediaDurationMs,
        coldFirstCueMs,
        warmIsolatedLatency: summarize(warmLatencies),
        firstBulkCueMs: orderedEvents[0]?.completedMs ?? null,
        bulkTranslationMs,
        cuesPerSecond: cues.length / (bulkTranslationMs / 1000),
        charactersPerSecond: sourceCharacters / (bulkTranslationMs / 1000),
        mediaToTranslationRatio: mediaDurationMs / bulkTranslationMs,
        rssBeforeBytes,
        rssAfterModelLoadBytes,
        peakRssBytes,
        peakRssDeltaBytes: peakRssBytes - rssBeforeBytes,
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
      writeFile(resolve(outputDirectory, 'input.srt'), toSrt(inputCues), 'utf8'),
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
      writeFile(
        resolve(outputDirectory, 'events.ndjson'),
        `${orderedEvents.map((event) => JSON.stringify(event)).join('\n')}\n`,
        'utf8',
      ),
    ]);
    return { benchmark, translatedCues };
  } finally {
    await translator.delete();
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
  const result = await runTranslationBenchmark({
    inputPath: args.input,
    outputDirectory: args.output ? resolve(args.output) : DEFAULT_OUTPUT_DIRECTORY,
    from: args.from,
    to: args.to,
    batchSize: args['batch-size'] ? Number(args['batch-size']) : 8,
    workers: args.workers ? Number(args.workers) : 1,
  });
  console.log(JSON.stringify(result.benchmark.metrics, null, 2));
}
