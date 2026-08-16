import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEMO_DIRECTORY = resolve(SOURCE_DIRECTORY, '..');
const REPOSITORY_DIRECTORY = resolve(DEMO_DIRECTORY, '..', '..');
const DEFAULT_SOURCE_ROOT = resolve(
  REPOSITORY_DIRECTORY,
  'demos',
  'subtitle-generation',
  'results',
  'youtube',
  'cuda-turbo-q5-desktop-3x',
);
const DEFAULT_OUTPUT_ROOT = resolve(DEMO_DIRECTORY, 'results', 'youtube', 'bergamot-wasm');
const VIDEOS = [
  { id: 'h0e2HAPTGF4', from: 'en', to: 'zh' },
  { id: 'LF9sd-2jCoY', from: 'zh', to: 'en' },
];

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

function formatNumber(value, digits = 1) {
  return value === null || value === undefined ? '—' : Number(value).toFixed(digits);
}

function toMarkdown(report) {
  const lines = [
    '# Bergamot 中英字幕翻译基准',
    '',
    '| 方向 | 时长 | 重复 | 冷首条 ms | 暖 P50/P95 ms | 整批 s | 倍速 | 峰值 RSS 增量 MiB |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const run of report.runs) {
    const metrics = run.metrics;
    lines.push(
      `| ${run.pair} | ${run.durationSeconds}s | ${run.repetition} | ${formatNumber(metrics.coldFirstCueMs)} | ${formatNumber(metrics.warmIsolatedLatency.p50Ms)}/${formatNumber(metrics.warmIsolatedLatency.p95Ms)} | ${formatNumber(metrics.bulkTranslationMs / 1000, 2)} | ${formatNumber(metrics.mediaToTranslationRatio)}x | ${formatNumber(metrics.peakRssDeltaBytes / 1024 / 1024)} |`,
    );
  }
  lines.push('', '每个运行目录均保留 `source.srt`、`translated.srt` 与 `bilingual.srt`。', '');
  return lines.join('\n');
}

async function runChildBenchmark({ inputPath, outputDirectory, from, to, batchSize }) {
  const benchmarkScript = resolve(SOURCE_DIRECTORY, 'benchmark.mjs');
  const exitCode = await new Promise((accept, reject) => {
    const child = spawn(
      process.execPath,
      [
        benchmarkScript,
        '--input',
        inputPath,
        '--output',
        outputDirectory,
        '--from',
        from,
        '--to',
        to,
        '--batch-size',
        String(batchSize),
      ],
      { stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', accept);
  });
  if (exitCode !== 0) throw new Error(`Translation benchmark child exited with code ${exitCode}.`);
  return JSON.parse(await readFile(resolve(outputDirectory, 'benchmark.json'), 'utf8'));
}

const args = parseArguments(process.argv.slice(2));
const sourceRoot = args['source-root'] ? resolve(args['source-root']) : DEFAULT_SOURCE_ROOT;
const outputRoot = args.output ? resolve(args.output) : DEFAULT_OUTPUT_ROOT;
const durations = (args.durations ?? '60,300,1200').split(',').map(Number);
const repetitions = args.repetitions ? Number(args.repetitions) : 3;
const batchSize = args['batch-size'] ? Number(args['batch-size']) : 8;
await mkdir(outputRoot, { recursive: true });

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  engine: 'bergamot-wasm',
  sourceRoot,
  configuration: { durations, repetitions, batchSize },
  runs: [],
};

for (const video of VIDEOS) {
  for (const durationSeconds of durations) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const inputPath = resolve(
        sourceRoot,
        video.id,
        `${durationSeconds}s`,
        'repeat-01',
        'subtitles.srt',
      );
      const outputDirectory = resolve(
        outputRoot,
        `${video.from}-${video.to}`,
        `${durationSeconds}s`,
        `repeat-${String(repetition).padStart(2, '0')}`,
      );
      console.log(
        `Translating ${video.from}->${video.to} ${durationSeconds}s (${repetition}/${repetitions})`,
      );
      const benchmark = await runChildBenchmark({
        inputPath,
        outputDirectory,
        from: video.from,
        to: video.to,
        batchSize,
      });
      report.runs.push({
        videoId: video.id,
        pair: `${video.from}-${video.to}`,
        durationSeconds,
        repetition,
        outputDirectory,
        metrics: benchmark.metrics,
      });
    }
  }
}

await Promise.all([
  writeFile(resolve(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(resolve(outputRoot, 'report.md'), toMarkdown(report), 'utf8'),
]);
console.log(`Report written to ${outputRoot}`);
