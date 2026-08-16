import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DEMO_ROOT, runProcess } from './runtime.mjs';

export const FUNASR_RUNTIME_VERSION = 'v0.1.9';
export const SENSEVOICE_MODEL = 'sensevoice-small-q8';
export const PARAFORMER_MODEL = 'paraformer-q8';

function funAsrRuntimeDirectory() {
  return join(
    DEMO_ROOT,
    '.runtime',
    'funasr',
    FUNASR_RUNTIME_VERSION,
    'cpu-avx2',
  );
}

async function verifyInstallation(installation, setupCommand) {
  for (const path of Object.values(installation)) {
    await stat(path).catch(() => {
      throw new Error(`FunASR dependency is missing: ${path}. Run ${setupCommand}.`);
    });
  }
  return installation;
}

export async function resolveSenseVoiceInstallation() {
  const runtimeDirectory = funAsrRuntimeDirectory();
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const installation = {
    executable: join(runtimeDirectory, `llama-funasr-sensevoice${executableSuffix}`),
    vadExecutable: join(runtimeDirectory, `llama-funasr-vad${executableSuffix}`),
    modelPath: join(DEMO_ROOT, '.models', 'funasr', 'sensevoice-small-q8.gguf'),
    vadModelPath: join(DEMO_ROOT, '.models', 'funasr', 'fsmn-vad.gguf'),
  };
  return verifyInstallation(installation, 'pnpm setup:sensevoice');
}

export async function resolveParaformerInstallation() {
  const runtimeDirectory = funAsrRuntimeDirectory();
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  return verifyInstallation({
    executable: join(runtimeDirectory, `llama-funasr-paraformer${executableSuffix}`),
    vadExecutable: join(runtimeDirectory, `llama-funasr-vad${executableSuffix}`),
    modelPath: join(DEMO_ROOT, '.models', 'funasr', 'paraformer-q8.gguf'),
    vadModelPath: join(DEMO_ROOT, '.models', 'funasr', 'fsmn-vad.gguf'),
  }, 'pnpm setup:paraformer');
}

export function parseVadSegments(source) {
  const segments = [];
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
    const startMs = Number(match[1]);
    const endMs = Number(match[2]);
    if (endMs <= startMs) throw new Error(`Invalid FSMN-VAD segment: ${line}`);
    segments.push({ startMs, endMs });
  }
  if (segments.length === 0) throw new Error('FSMN-VAD did not return any speech segments.');
  return segments;
}

export function parseSenseVoiceSegments(source) {
  const segmentPattern = /<\|([^|]+)\|><\|([^|]+)\|><\|([^|]+)\|><\|([^|]+)\|>([\s\S]*?)(?=<\|[^|]+\|><\|[^|]+\|><\|[^|]+\|><\|[^|]+\|>|$)/gu;
  const segments = Array.from(source.matchAll(segmentPattern), (match) => ({
    language: match[1],
    emotion: match[2],
    event: match[3],
    textNormalization: match[4],
    text: match[5].trim(),
  })).filter((segment) => segment.text.length > 0);
  if (segments.length === 0) throw new Error('SenseVoiceSmall did not return tagged text segments.');
  return segments;
}

function splitOversizedText(text, maximumCharacters) {
  const characters = Array.from(text);
  const chunks = [];
  for (let offset = 0; offset < characters.length; offset += maximumCharacters) {
    chunks.push(characters.slice(offset, offset + maximumCharacters).join('').trim());
  }
  return chunks.filter(Boolean);
}

export function splitSubtitleText(text, maximumCharacters = 28) {
  if (!Number.isInteger(maximumCharacters) || maximumCharacters < 1) {
    throw new Error('maximumCharacters must be a positive integer.');
  }
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return [];
  const clauses = normalized.match(/[^，。！？!?；;,.、：:]+[，。！？!?；;,.、：:]?/gu) ?? [normalized];
  const chunks = [];
  let current = '';

  for (const clause of clauses) {
    const candidate = `${current}${clause}`;
    if (Array.from(candidate).length <= maximumCharacters) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current.trim());
    if (Array.from(clause).length > maximumCharacters) {
      const oversized = splitOversizedText(clause, maximumCharacters);
      chunks.push(...oversized.slice(0, -1));
      current = oversized.at(-1) ?? '';
    } else {
      current = clause;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function textWeight(text) {
  return Math.max(1, Array.from(text).filter((character) => !/\s/u.test(character)).length);
}

function appendTimedCues(cues, timing, chunks, details) {
  const weights = chunks.map(textWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let consumedWeight = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const startMs = timing.startMs + Math.round(
      ((timing.endMs - timing.startMs) * consumedWeight) / totalWeight,
    );
    consumedWeight += weights[chunkIndex];
    const endMs = chunkIndex === chunks.length - 1
      ? timing.endMs
      : timing.startMs + Math.round(
        ((timing.endMs - timing.startMs) * consumedWeight) / totalWeight,
      );
    cues.push({
      id: `cue-${String(cues.length + 1).padStart(6, '0')}`,
      startMs,
      endMs,
      text: chunks[chunkIndex],
      state: 'final',
      ...details,
    });
  }
}

export function canonicalCuesFromSenseVoice(
  vadSegments,
  recognizedSegments,
  maximumCharacters = 28,
) {
  if (vadSegments.length !== recognizedSegments.length) {
    throw new Error(
      `SenseVoice/VAD segment count mismatch: ${recognizedSegments.length} text segments for ${vadSegments.length} time segments.`,
    );
  }

  const cues = [];
  for (let segmentIndex = 0; segmentIndex < vadSegments.length; segmentIndex += 1) {
    const timing = vadSegments[segmentIndex];
    const recognized = recognizedSegments[segmentIndex];
    const chunks = splitSubtitleText(recognized.text, maximumCharacters);
    appendTimedCues(cues, timing, chunks, {
      timingSource: 'fsmn-vad-proportional',
      senseVoice: {
        language: recognized.language,
        emotion: recognized.emotion,
        event: recognized.event,
      },
    });
  }
  return cues;
}

export function canonicalCuesFromParaformer(
  vadSegments,
  recognizedText,
  maximumCharacters = 22,
) {
  const characters = Array.from(recognizedText.replace(/\s+/gu, '').trim());
  if (characters.length === 0) throw new Error('Paraformer did not return text.');
  const totalSpeechMs = vadSegments.reduce(
    (sum, segment) => sum + segment.endMs - segment.startMs,
    0,
  );
  const cues = [];
  let consumedSpeechMs = 0;
  let consumedCharacters = 0;

  for (let index = 0; index < vadSegments.length; index += 1) {
    const timing = vadSegments[index];
    consumedSpeechMs += timing.endMs - timing.startMs;
    const endCharacter = index === vadSegments.length - 1
      ? characters.length
      : Math.round((characters.length * consumedSpeechMs) / totalSpeechMs);
    const segmentText = characters.slice(consumedCharacters, endCharacter).join('');
    consumedCharacters = endCharacter;
    appendTimedCues(
      cues,
      timing,
      splitSubtitleText(segmentText, maximumCharacters),
      {
        timingSource: 'fsmn-vad-global-proportional',
        punctuationSource: 'none',
      },
    );
  }
  return cues;
}

export async function runSenseVoice({
  installation,
  normalizedPath,
  maximumCharacters = 28,
}) {
  const startedAt = performance.now();
  const vad = await runProcess(installation.vadExecutable, [
    '-m', installation.vadModelPath,
    '-a', normalizedPath,
  ]);
  const recognition = await runProcess(installation.executable, [
    '-m', installation.modelPath,
    '-a', normalizedPath,
    '--vad', installation.vadModelPath,
    '--backend', 'cpu',
    '--keep-tags',
  ]);
  const vadSegments = parseVadSegments(vad.stdout);
  const recognizedSegments = parseSenseVoiceSegments(recognition.stdout);
  const cues = canonicalCuesFromSenseVoice(
    vadSegments,
    recognizedSegments,
    maximumCharacters,
  );
  const durationMs = performance.now() - startedAt;
  return {
    cues,
    vadSegments,
    recognizedSegments,
    durationMs,
    firstCueMs: cues.length === 0 ? null : durationMs,
    stdout: recognition.stdout,
    stderr: `${vad.stderr}${recognition.stderr}`,
    vadStdout: vad.stdout,
  };
}

export async function runParaformer({
  installation,
  normalizedPath,
  maximumCharacters = 22,
}) {
  const startedAt = performance.now();
  const vad = await runProcess(installation.vadExecutable, [
    '-m', installation.vadModelPath,
    '-a', normalizedPath,
  ]);
  const recognition = await runProcess(installation.executable, [
    '-m', installation.modelPath,
    '-a', normalizedPath,
    '--vad', installation.vadModelPath,
  ]);
  const vadSegments = parseVadSegments(vad.stdout);
  const recognizedText = recognition.stdout.trim();
  const cues = canonicalCuesFromParaformer(
    vadSegments,
    recognizedText,
    maximumCharacters,
  );
  const durationMs = performance.now() - startedAt;
  return {
    cues,
    vadSegments,
    recognizedText,
    durationMs,
    firstCueMs: cues.length === 0 ? null : durationMs,
    stdout: recognition.stdout,
    stderr: `${vad.stderr}${recognition.stderr}`,
    vadStdout: vad.stdout,
  };
}
