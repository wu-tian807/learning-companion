import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCuesForTranslation } from './prepare-cues.mjs';
import { parseSrt, toSrt } from './srt.mjs';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEMO_DIRECTORY = resolve(SOURCE_DIRECTORY, '..');
const REPOSITORY_DIRECTORY = resolve(DEMO_DIRECTORY, '..', '..');
const SOURCE_ROOT = resolve(
  REPOSITORY_DIRECTORY,
  'demos',
  'subtitle-generation',
  'results',
  'youtube',
  'cuda-turbo-q5-desktop-3x',
);
const MODELS_ROOT = resolve(DEMO_DIRECTORY, '.models', 'argos', 'extracted');
const PYTHON_PACKAGES = resolve(DEMO_DIRECTORY, '.runtime', 'ct2-python-packages');
const DEFAULT_OUTPUT = resolve(DEMO_DIRECTORY, 'results', 'youtube', 'ct2-argos-opus-mt-int8');
const VIDEOS = [
  { id: 'h0e2HAPTGF4', from: 'en', to: 'zh' },
  { id: 'LF9sd-2jCoY', from: 'zh', to: 'en' },
];

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    options[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

function format(value, digits = 1) {
  return value === null || value === undefined ? '—' : Number(value).toFixed(digits);
}

function markdown(report) {
  const lines = [
    '# CTranslate2 / Argos OPUS-MT 中英字幕翻译基准',
    '',
    '| 方向 | 时长 | 重复 | 模型加载 ms | 冷首条 ms | 暖 P50/P95 ms | 整批 s | 倍速 | 峰值 RSS 增量 MiB |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const run of report.runs) {
    const metrics = run.metrics;
    lines.push(
      `| ${run.pair} | ${run.durationSeconds}s | ${run.repetition} | ${format(metrics.modelLoadMs)} | ${format(metrics.coldFirstCueMs)} | ${format(metrics.warmIsolatedLatency.p50Ms)}/${format(metrics.warmIsolatedLatency.p95Ms)} | ${format(metrics.bulkTranslationMs / 1000, 2)} | ${format(metrics.mediaToTranslationRatio)}x | ${format(metrics.peakRssDeltaBytes / 1024 / 1024)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function runPython({ python, input, output, from, to, batchSize }) {
  const args = [
    resolve(SOURCE_DIRECTORY, 'ct2-benchmark.py'),
    '--input',
    input,
    '--output',
    output,
    '--from',
    from,
    '--to',
    to,
    '--models-root',
    MODELS_ROOT,
    '--batch-size',
    String(batchSize),
  ];
  const code = await new Promise((accept, reject) => {
    const child = spawn(python, args, {
      stdio: 'inherit',
      env: { ...process.env, PYTHONPATH: PYTHON_PACKAGES },
    });
    child.once('error', reject);
    child.once('exit', accept);
  });
  if (code !== 0) throw new Error(`CTranslate2 benchmark exited with code ${code}.`);
}

const args = parseArguments(process.argv.slice(2));
const python = args.python ?? process.env.LC_PYTHON;
if (!python) throw new Error('Set LC_PYTHON or pass --python with a Python 3.12 executable.');
const outputRoot = args.output ? resolve(args.output) : DEFAULT_OUTPUT;
const durations = (args.durations ?? '60,300,1200').split(',').map(Number);
const repetitions = args.repetitions ? Number(args.repetitions) : 3;
const batchSize = args['batch-size'] ? Number(args['batch-size']) : 8;
await mkdir(outputRoot, { recursive: true });

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  engine: 'ctranslate2-argos-opus-mt-int8',
  configuration: { durations, repetitions, batchSize },
  runs: [],
};

for (const video of VIDEOS) {
  for (const durationSeconds of durations) {
    const rawPath = resolve(
      SOURCE_ROOT,
      video.id,
      `${durationSeconds}s`,
      'repeat-01',
      'subtitles.srt',
    );
    const rawCues = parseSrt(await readFile(rawPath, 'utf8'));
    const prepared = prepareCuesForTranslation(rawCues, video.from);
    const preparedPath = resolve(outputRoot, '.prepared', `${video.from}-${video.to}-${durationSeconds}s.srt`);
    await mkdir(dirname(preparedPath), { recursive: true });
    await writeFile(preparedPath, toSrt(prepared), 'utf8');

    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const output = resolve(
        outputRoot,
        `${video.from}-${video.to}`,
        `${durationSeconds}s`,
        `repeat-${String(repetition).padStart(2, '0')}`,
      );
      console.log(`Translating ${video.from}->${video.to} ${durationSeconds}s (${repetition}/${repetitions})`);
      await runPython({ python, input: preparedPath, output, from: video.from, to: video.to, batchSize });
      const benchmark = JSON.parse(await readFile(resolve(output, 'benchmark.json'), 'utf8'));
      report.runs.push({
        videoId: video.id,
        pair: `${video.from}-${video.to}`,
        durationSeconds,
        repetition,
        outputDirectory: output,
        metrics: benchmark.metrics,
      });
    }
  }
}

await Promise.all([
  writeFile(resolve(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(resolve(outputRoot, 'report.md'), markdown(report), 'utf8'),
]);
console.log(`Report written to ${outputRoot}`);
