#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import console from 'node:console';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { measureAccuracy } from './transcript.mjs';
import {
  parseVtt,
  subtitleStructure,
  subtitleTimingAgreement,
} from './reference-vtt.mjs';

const DEMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(argv) {
  const options = { engine: 'whisper', useVad: true, repetitions: 1, threads: Math.max(4, Math.floor(cpus().length / 2)) };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-vad') {
      options.useVad = false;
      continue;
    }
    if (argument === '--cold-normalization') {
      options.coldNormalization = true;
      continue;
    }
    if (argument === '--report-only') {
      options.reportOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!argument.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid argument: ${argument}`);
    index += 1;
    options[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
  }
  options.threads = Number(options.threads);
  options.repetitions = Number(options.repetitions);
  options.durations = options.durations
    ? String(options.durations).split(',').map(Number)
    : undefined;
  options.videos = options.videos
    ? String(options.videos).split(',').map((value) => value.trim()).filter(Boolean)
    : undefined;
  if (!['whisper', 'sensevoice', 'paraformer'].includes(options.engine)) {
    throw new Error('--engine must be whisper, sensevoice, or paraformer.');
  }
  options.backend ??= options.engine === 'whisper' ? 'cuda' : 'cpu';
  options.model ??= options.engine === 'sensevoice'
    ? 'sensevoice-small-q8'
    : options.engine === 'paraformer' ? 'paraformer-q8' : 'large-v3-turbo-q5_0';
  if (options.engine === 'whisper' && !['cpu', 'cuda'].includes(options.backend)) {
    throw new Error('Whisper --backend must be cpu or cuda.');
  }
  if (options.engine !== 'whisper' && options.backend !== 'cpu') {
    throw new Error('The verified FunASR llama.cpp backends are cpu only.');
  }
  if (options.engine !== 'whisper' && !options.useVad) {
    throw new Error('The FunASR llama.cpp engines require FSMN-VAD to produce subtitle timing.');
  }
  if (!Number.isInteger(options.threads) || options.threads < 1) throw new Error('--threads must be a positive integer.');
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1) throw new Error('--repetitions must be a positive integer.');
  if (options.durations?.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error('--durations must be a comma-separated list of positive integer seconds.');
  }
  return options;
}

function spawnCapture(command, args) {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const completed = new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolvePromise({ exitCode, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
  });
  return { child, completed };
}

function stopMonitor(monitor) {
  if (monitor?.child && monitor.child.exitCode === null) monitor.child.kill();
}

function parseTypeperf(source) {
  const samples = [];
  for (const line of source.split(/\r?\n/u)) {
    const fields = Array.from(line.matchAll(/"([^"]*)"/gu), (match) => match[1]);
    if (fields.length < 3 || !Number.isFinite(Number(fields[1]))) continue;
    samples.push({ cpuPercent: Number(fields[1]), availableMemoryMb: Number(fields[2]) });
  }
  return samples;
}

function parseNvidiaSmi(source) {
  return source
    .split(/\r?\n/u)
    .map((line) => line.split(',').map((value) => Number(value.trim())))
    .filter((values) => values.length >= 4 && values.every(Number.isFinite))
    .map(([gpuPercent, memoryUsedMb, memoryTotalMb, powerWatts]) => ({ gpuPercent, memoryUsedMb, memoryTotalMb, powerWatts }));
}

function average(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(values) {
  return values.length === 0 ? null : Math.max(...values);
}

function minimum(values) {
  return values.length === 0 ? null : Math.min(...values);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function resourceSummary(
  typeperfSamples,
  gpuSamples,
  baselineSystemUsedMemoryMb,
  baselineGpuMemoryMb,
) {
  const availableMemory = typeperfSamples.map((sample) => sample.availableMemoryMb);
  const usedMemory = availableMemory.map((available) => totalmem() / 1_048_576 - available);
  const gpuMemory = gpuSamples.map((sample) => sample.memoryUsedMb);
  return {
    sampleCount: { system: typeperfSamples.length, gpu: gpuSamples.length },
    systemCpuPercent: {
      average: average(typeperfSamples.map((sample) => sample.cpuPercent)),
      peak: maximum(typeperfSamples.map((sample) => sample.cpuPercent)),
    },
    systemUsedMemoryMb: {
      baseline: baselineSystemUsedMemoryMb,
      average: average(usedMemory),
      peak: maximum(usedMemory),
      peakDelta:
        maximum(usedMemory) === null
          ? null
          : maximum(usedMemory) - baselineSystemUsedMemoryMb,
    },
    gpuPercent: { average: average(gpuSamples.map((sample) => sample.gpuPercent)), peak: maximum(gpuSamples.map((sample) => sample.gpuPercent)) },
    gpuMemoryMb: {
      baseline: baselineGpuMemoryMb,
      peak: maximum(gpuMemory),
      peakDelta: maximum(gpuMemory) === null || baselineGpuMemoryMb === null ? null : maximum(gpuMemory) - baselineGpuMemoryMb,
    },
    gpuPowerWatts: { average: average(gpuSamples.map((sample) => sample.powerWatts)), peak: maximum(gpuSamples.map((sample) => sample.powerWatts)) },
  };
}

function currentGpuMemoryMb() {
  const result = spawnSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return null;
  const value = Number(result.stdout.trim().split(/\r?\n/u)[0]);
  return Number.isFinite(value) ? value : null;
}

async function runMeasured(command, args, { monitorGpu }) {
  const baselineSystemUsedMemoryMb = (totalmem() - freemem()) / 1_048_576;
  const baselineGpuMemoryMb = monitorGpu ? currentGpuMemoryMb() : null;
  const typeperf = spawnCapture('typeperf', ['\\Processor(_Total)\\% Processor Time', '\\Memory\\Available MBytes', '-si', '1']);
  const nvidia = monitorGpu
    ? spawnCapture('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total,power.draw', '--format=csv,noheader,nounits', '-lms', '500'])
    : undefined;
  const run = spawnCapture(command, args);
  const result = await run.completed;
  stopMonitor(typeperf);
  stopMonitor(nvidia);
  const [typeperfResult, nvidiaResult] = await Promise.all([
    typeperf.completed.catch(() => ({ stdout: '' })),
    nvidia?.completed.catch(() => ({ stdout: '' })) ?? Promise.resolve({ stdout: '' }),
  ]);
  if (result.exitCode !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);
  return {
    result,
    resources: resourceSummary(
      parseTypeperf(typeperfResult.stdout),
      parseNvidiaSmi(nvidiaResult.stdout),
      baselineSystemUsedMemoryMb,
      baselineGpuMemoryMb,
    ),
  };
}

function cueOutsideExclusions(cue, exclusions) {
  const midpointMs = cue.startMs + (cue.endMs - cue.startMs) / 2;
  return !exclusions.some(
    (range) => midpointMs >= range.startMs && midpointMs < range.endMs,
  );
}

function summarizeRuns(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = `${run.videoId}:${run.durationSeconds}`;
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  return Array.from(groups.values(), (group) => {
    const first = group[0];
    const transcriptionTimes = group.map((run) => run.metrics.transcriptionMs);
    const endToEndTimes = group.map((run) => run.metrics.endToEndMs);
    return {
      videoId: first.videoId,
      title: first.title,
      language: first.language,
      durationSeconds: first.durationSeconds,
      sampleCount: group.length,
      metrics: {
        transcriptionMs: median(transcriptionTimes),
        transcriptionRangeMs: {
          minimum: minimum(transcriptionTimes),
          maximum: maximum(transcriptionTimes),
        },
        endToEndMs: median(endToEndTimes),
        endToEndRangeMs: {
          minimum: minimum(endToEndTimes),
          maximum: maximum(endToEndTimes),
        },
        firstCueMs: median(
          group.map((run) => run.metrics.firstCueMs).filter((value) => value !== null),
        ),
        realTimeFactor: median(group.map((run) => run.metrics.realTimeFactor)),
      },
      quality: {
        referenceKind: first.quality.referenceKind,
        exclusions: first.quality.exclusions,
        accuracy: {
          metric: first.quality.accuracy.metric,
          rate: median(group.map((run) => run.quality.accuracy.rate).filter((value) => value !== null)),
        },
        structure: {
          longDurationCount: maximum(
            group.map((run) => run.quality.structure.longDurationCount),
          ),
          maximumDurationMs: maximum(
            group.map((run) => run.quality.structure.maximumDurationMs),
          ),
        },
        timing: {
          speechIntersectionOverUnion: median(
            group
              .map((run) => run.quality.timing.speechIntersectionOverUnion)
              .filter((value) => value !== null),
          ),
        },
      },
      resources: {
        systemCpuPercent: {
          average: median(
            group
              .map((run) => run.resources.systemCpuPercent.average)
              .filter((value) => value !== null),
          ),
        },
        systemUsedMemoryMb: {
          peakDelta: median(
            group
              .map((run) => run.resources.systemUsedMemoryMb.peakDelta)
              .filter((value) => value !== null),
          ),
          peakDeltaRange: {
            minimum: minimum(
              group
                .map((run) => run.resources.systemUsedMemoryMb.peakDelta)
                .filter((value) => value !== null),
            ),
            maximum: maximum(
              group
                .map((run) => run.resources.systemUsedMemoryMb.peakDelta)
                .filter((value) => value !== null),
            ),
          },
        },
        gpuPercent: {
          average: median(
            group
              .map((run) => run.resources.gpuPercent.average)
              .filter((value) => value !== null),
          ),
        },
        gpuMemoryMb: {
          peakDelta: median(
            group
              .map((run) => run.resources.gpuMemoryMb.peakDelta)
              .filter((value) => value !== null),
          ),
          peakDeltaRange: {
            minimum: minimum(
              group
                .map((run) => run.resources.gpuMemoryMb.peakDelta)
                .filter((value) => value !== null),
            ),
            maximum: maximum(
              group
                .map((run) => run.resources.gpuMemoryMb.peakDelta)
                .filter((value) => value !== null),
            ),
          },
        },
      },
    };
  });
}

function linearRegression(points) {
  if (points.length < 2) return undefined;
  const meanX = average(points.map((point) => point.x));
  const meanY = average(points.map((point) => point.y));
  const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const variance = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  const slope = covariance / variance;
  const intercept = meanY - slope * meanX;
  const residual = points.reduce((sum, point) => sum + (point.y - (intercept + slope * point.x)) ** 2, 0);
  const total = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  return { slopeMsPerMediaSecond: slope, interceptMs: intercept, rSquared: total === 0 ? 1 : 1 - residual / total, projectedSixtyMinuteMs: intercept + slope * 3_600 };
}

function createScaling(videos, summaryRuns) {
  return Object.fromEntries(
    videos.map((video) => [
      video.id,
      {
        transcription: linearRegression(
          summaryRuns
            .filter((run) => run.videoId === video.id)
            .map((run) => ({
              x: run.durationSeconds,
              y: run.metrics.transcriptionMs,
            })),
        ),
        endToEnd: linearRegression(
          summaryRuns
            .filter((run) => run.videoId === video.id)
            .map((run) => ({
              x: run.durationSeconds,
              y: run.metrics.endToEndMs,
            })),
        ),
      },
    ]),
  );
}

function markdownReport(report) {
  const rows = report.summaryRuns.map((run) => {
    const errorRate = run.quality.accuracy.rate;
    const transcriptionRange = `${(run.metrics.transcriptionRangeMs.minimum / 1_000).toFixed(1)}–${(run.metrics.transcriptionRangeMs.maximum / 1_000).toFixed(1)}`;
    return `| ${run.videoId} | ${run.durationSeconds} | ${run.sampleCount} | ${(run.metrics.transcriptionMs / 1_000).toFixed(2)} s (${transcriptionRange}) | ${(run.metrics.endToEndMs / 1_000).toFixed(2)} s | ${run.metrics.firstCueMs ?? 'n/a'} ms | ${run.metrics.realTimeFactor.toFixed(3)} | ${errorRate === null ? 'n/a' : `${(errorRate * 100).toFixed(2)}% ${run.quality.accuracy.metric.toUpperCase()}`} | ${run.quality.timing.speechIntersectionOverUnion === null ? 'n/a' : `${(run.quality.timing.speechIntersectionOverUnion * 100).toFixed(1)}%`} | ${run.quality.structure.longDurationCount} / ${(run.quality.structure.maximumDurationMs / 1_000).toFixed(1)} s | ${run.resources.systemCpuPercent.average?.toFixed(1) ?? 'n/a'}% | ${run.resources.systemUsedMemoryMb.peakDelta?.toFixed(0) ?? 'n/a'} MiB | ${run.resources.gpuPercent.average?.toFixed(1) ?? 'n/a'}% | ${run.resources.gpuMemoryMb.peakDelta?.toFixed(0) ?? 'n/a'} MiB |`;
  });
  const scaling = Object.entries(report.scaling).map(([videoId, value]) =>
    value?.transcription && value.endToEnd
      ? `- ${videoId}: 转录 R² ${value.transcription.rSquared.toFixed(4)}、每媒体秒增加 ${value.transcription.slopeMsPerMediaSecond.toFixed(2)} ms、估算 60 分钟 ${(value.transcription.projectedSixtyMinuteMs / 1_000).toFixed(1)} 秒；含首次音频规范化后估算 ${(value.endToEnd.projectedSixtyMinuteMs / 1_000).toFixed(1)} 秒。`
      : `- ${videoId}: 至少需要两个时长档位才能拟合耗时曲线。`,
  );
  const engine = report.configuration.engine ?? 'whisper';
  const threads = report.configuration.threads ?? 'runtime default';
  const timingNote = engine === 'sensevoice'
    ? 'SenseVoiceSmall 的 Cue 时间来自 FSMN-VAD，并在同一 VAD 段内按文本长度分配，不是词级时间戳。'
    : engine === 'paraformer'
      ? 'Paraformer GGUF 不输出标点、段文本边界或时间戳；Cue 先按语音时长把全文分配到 FSMN-VAD 段，再按固定字符数切分，仅用于比较文本和展示近似时间轴。'
      : '';
  return `# YouTube 字幕基准\n\n- 配置：${engine} / ${report.configuration.backend} / ${report.configuration.model} / VAD ${report.configuration.useVad ? '开启' : '关闭'} / ${threads} threads\n- 生成时间：${report.generatedAt}\n\n| Video | 时长 | 样本数 | 转录中位数（范围） | 端到端中位数 | 首 Cue 中位数 | RTF 中位数 | 文本误差 | 时间覆盖 IoU | >7s Cue 数 / 最长 Cue | 系统 CPU 均值中位数 | RAM 峰值增量中位数 | GPU 均值中位数 | GPU 显存峰值增量中位数 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\n## 时长增长\n\n${scaling.join('\n')}\n\n> 耗时、首 Cue、RTF、利用率和资源增量均取重复运行中位数；完整范围与逐次样本保存在 JSON。CPU 与内存是整机采样，可能包含其他应用。人工字幕是参考文本，但仍可能含编辑性改写。${timingNote}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(join(DEMO_ROOT, 'fixtures', 'youtube-benchmark.json'), 'utf8'));
  const videos = options.videos
    ? manifest.videos.filter((video) => options.videos.includes(video.id))
    : manifest.videos;
  const durations = options.durations ?? manifest.durationsSeconds;
  if (videos.length === 0) throw new Error('No videos matched --videos.');
  const unavailableDurations = durations.filter(
    (duration) => !manifest.durationsSeconds.includes(duration),
  );
  if (unavailableDurations.length > 0) {
    throw new Error(`Unavailable prepared durations: ${unavailableDurations.join(', ')}.`);
  }
  const outputRoot = resolve(options.output ?? join(DEMO_ROOT, 'results', 'youtube', `${options.engine}-${options.backend}-${options.model}-${options.useVad ? 'vad' : 'no-vad'}-t${options.threads}`));
  await mkdir(outputRoot, { recursive: true });
  if (options.reportOnly) {
    const reportPath = join(outputRoot, 'report.json');
    const existing = JSON.parse(await readFile(reportPath, 'utf8'));
    const summaryRuns = summarizeRuns(existing.runs);
    const report = {
      ...existing,
      generatedAt: new Date().toISOString(),
      configuration: {
        ...existing.configuration,
        threads: (existing.configuration.engine ?? 'whisper') === 'whisper'
          ? existing.configuration.threads
          : null,
      },
      summaryRuns,
      scaling: createScaling(existing.videos, summaryRuns),
    };
    await Promise.all([
      writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
      writeFile(join(outputRoot, 'report.md'), markdownReport(report), 'utf8'),
    ]);
    console.log(`Report refreshed: ${join(outputRoot, 'report.md')}`);
    return;
  }
  const runs = [];

  for (const video of videos) {
    const reference = parseVtt(await readFile(join(DEMO_ROOT, '.datasets', 'youtube', 'raw', video.id, `${video.id}.${video.subtitleLanguage}.vtt`), 'utf8'));
    for (const durationSeconds of durations) {
      for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
        const runDirectory = options.repetitions === 1
          ? join(outputRoot, video.id, `${durationSeconds}s`)
          : join(outputRoot, video.id, `${durationSeconds}s`, `repeat-${String(repetition).padStart(2, '0')}`);
        const inputPath = join(DEMO_ROOT, '.datasets', 'youtube', 'clips', video.id, `${durationSeconds}s.m4a`);
        if (options.coldNormalization) {
          await rm(join(DEMO_ROOT, '.cache', 'normalized'), {
            recursive: true,
            force: true,
          });
        }
        const args = options.engine !== 'whisper'
          ? [join(DEMO_ROOT, 'src', 'funasr-cli.mjs'), 'transcribe', '--engine', options.engine, '--input', inputPath, '--output', runDirectory]
          : [join(DEMO_ROOT, 'src', 'cli.mjs'), 'transcribe', '--input', inputPath, '--backend', options.backend, '--model', options.model, '--language', video.language, '--threads', String(options.threads), '--output', runDirectory];
        if (!options.useVad && options.engine === 'whisper') args.push('--no-vad');
        console.log(`Benchmarking ${video.id} ${durationSeconds}s (${repetition}/${options.repetitions})...`);
        const measured = await runMeasured(process.execPath, args, {
          monitorGpu: options.engine === 'whisper' && options.backend === 'cuda',
        });
        const transcript = JSON.parse(await readFile(join(runDirectory, 'transcript.json'), 'utf8'));
        const benchmark = JSON.parse(await readFile(join(runDirectory, 'benchmark.json'), 'utf8'));
        const exclusions = video.qualityExclusionRangesMs ?? [];
        const boundedReference = reference.filter(
          (cue) => cue.endMs <= benchmark.source.durationMs,
        );
        const evaluatedReference = boundedReference.filter((cue) =>
          cueOutsideExclusions(cue, exclusions),
        );
        const evaluatedTranscript = transcript.cues.filter((cue) =>
          cueOutsideExclusions(cue, exclusions),
        );
        const referenceText = evaluatedReference.map((cue) => cue.text).join(' ');
        const hypothesis = evaluatedTranscript.map((cue) => cue.text).join(' ');
        runs.push({
          videoId: video.id,
          title: video.title,
          language: video.language,
          durationSeconds,
          repetition,
          metrics: benchmark.metrics,
          quality: {
            referenceKind: video.referenceKind,
            exclusions,
            accuracy: measureAccuracy(referenceText, hypothesis, video.language),
            structure: subtitleStructure(transcript.cues, benchmark.source.durationMs),
            timing: subtitleTimingAgreement(
              reference.filter((cue) => cue.startMs < benchmark.source.durationMs),
              transcript.cues,
              benchmark.source.durationMs,
            ),
          },
          resources: measured.resources,
        });
      }
    }
  }

  const summaryRuns = summarizeRuns(runs);
  const scaling = createScaling(videos, summaryRuns);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configuration: {
      engine: options.engine,
      backend: options.backend,
      model: options.model,
      useVad: options.useVad,
      threads: options.engine === 'whisper' ? options.threads : null,
      repetitions: options.repetitions,
      coldNormalization: options.coldNormalization === true,
    },
    videos,
    runs,
    summaryRuns,
    scaling,
  };
  await Promise.all([
    writeFile(join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(join(outputRoot, 'report.md'), markdownReport(report), 'utf8'),
  ]);
  console.log(`Report: ${join(outputRoot, 'report.md')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
