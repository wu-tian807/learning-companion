import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVtt } from '../../subtitle-generation/src/reference-vtt.mjs';
import { prepareCuesForTranslation } from './prepare-cues.mjs';
import { toSrt } from './srt.mjs';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEMO_DIRECTORY = resolve(SOURCE_DIRECTORY, '..');
const REPOSITORY_DIRECTORY = resolve(DEMO_DIRECTORY, '..', '..');
const DATASET_ROOT = resolve(
  REPOSITORY_DIRECTORY,
  'demos',
  'subtitle-generation',
  '.datasets',
  'youtube',
  'raw',
);
const SOURCES = [
  { id: 'h0e2HAPTGF4', language: 'en', file: 'h0e2HAPTGF4.en.vtt' },
  { id: 'LF9sd-2jCoY', language: 'zh', file: 'LF9sd-2jCoY.zh.vtt' },
];

const durationSeconds = Number(process.argv[2] ?? 60);
const durationMs = durationSeconds * 1000;
const outputRoot = resolve(DEMO_DIRECTORY, '.cache', 'human-source', `${durationSeconds}s`);
await mkdir(outputRoot, { recursive: true });

for (const source of SOURCES) {
  const vttPath = resolve(DATASET_ROOT, source.id, source.file);
  const raw = parseVtt(await readFile(vttPath, 'utf8'))
    .filter((cue) => cue.endMs <= durationMs)
    .map((cue, index) => ({ ...cue, id: `raw-${String(index + 1).padStart(6, '0')}` }));
  const prepared = prepareCuesForTranslation(raw, source.language);
  const outputPath = resolve(outputRoot, `${source.language}.srt`);
  await writeFile(outputPath, toSrt(prepared), 'utf8');
  console.log(`${source.language}: ${raw.length} raw cues -> ${prepared.length} prepared cues (${outputPath})`);
}
