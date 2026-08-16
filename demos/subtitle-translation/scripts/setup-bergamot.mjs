import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const REGISTRY_URL =
  'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json';
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEMO_DIRECTORY = resolve(SCRIPT_DIRECTORY, '..');
const MODELS_DIRECTORY = resolve(DEMO_DIRECTORY, '.models', 'bergamot');
const MANIFEST_PATH = join(MODELS_DIRECTORY, 'manifest.json');

const REQUESTED_PAIRS = [
  { pair: 'en-zh', preferredStatus: 'Release' },
  { pair: 'zh-en', preferredStatus: 'Release Desktop' },
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function downloadAndInflate(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  const compressed = Buffer.from(await response.arrayBuffer());
  return {
    compressedBytes: compressed.byteLength,
    buffer: gunzipSync(compressed),
  };
}

function pickReleasedModel(registry, pair, preferredStatus) {
  const candidates = registry.models?.[pair];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error(`Mozilla registry has no ${pair} model.`);
  }
  return (
    candidates.find((candidate) => candidate.releaseStatus === preferredStatus) ??
    candidates.find((candidate) => String(candidate.releaseStatus ?? '').startsWith('Release')) ??
    candidates[0]
  );
}

function modelParts(model) {
  const files = model.files ?? {};
  const vocabEntries = files.vocab
    ? [['vocab', files.vocab]]
    : [
        ['srcVocab', files.srcVocab],
        ['trgVocab', files.trgVocab],
      ];
  const entries = [
    ['model', files.model],
    ['shortlist', files.lexicalShortlist],
    ...vocabEntries,
  ];
  for (const [kind, entry] of entries) {
    if (!entry?.path) throw new Error(`Model file ${kind} is missing.`);
  }
  return entries;
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function installPart({ baseUrl, pairDirectory, kind, entry, expectedHash }) {
  const destination = join(pairDirectory, `${kind}.bin`);
  if (await fileExists(destination)) {
    const existing = await readFile(destination);
    const existingHash = sha256(existing);
    if (!expectedHash || existingHash === expectedHash) {
      return {
        path: relative(MODELS_DIRECTORY, destination).replaceAll('\\', '/'),
        sha256: existingHash,
        uncompressedBytes: existing.byteLength,
        compressedBytes: null,
        cacheHit: true,
      };
    }
  }

  const sourceUrl = `${baseUrl}/${entry.path}`;
  const { compressedBytes, buffer } = await downloadAndInflate(sourceUrl);
  const actualHash = sha256(buffer);
  if (expectedHash && actualHash !== expectedHash) {
    throw new Error(`SHA-256 mismatch for ${sourceUrl}.`);
  }

  const temporary = `${destination}.partial`;
  await writeFile(temporary, buffer);
  await rm(destination, { force: true });
  await rename(temporary, destination);
  return {
    path: relative(MODELS_DIRECTORY, destination).replaceAll('\\', '/'),
    sha256: actualHash,
    uncompressedBytes: buffer.byteLength,
    compressedBytes,
    cacheHit: false,
  };
}

async function main() {
  await mkdir(MODELS_DIRECTORY, { recursive: true });
  const response = await fetch(REGISTRY_URL);
  if (!response.ok) throw new Error(`Could not load Mozilla model registry (${response.status}).`);
  const registry = await response.json();
  const manifest = {
    schemaVersion: 1,
    installedAt: new Date().toISOString(),
    registryUrl: REGISTRY_URL,
    registryGeneratedAt: registry.generated ?? null,
    license: 'MPL-2.0',
    models: {},
  };

  for (const request of REQUESTED_PAIRS) {
    const model = pickReleasedModel(registry, request.pair, request.preferredStatus);
    const pairDirectory = join(MODELS_DIRECTORY, request.pair);
    await mkdir(pairDirectory, { recursive: true });
    const installedParts = {};
    for (const [kind, entry] of modelParts(model)) {
      installedParts[kind] = await installPart({
        baseUrl: registry.baseUrl,
        pairDirectory,
        kind,
        entry,
        expectedHash: kind === 'model' ? entry.uncompressedHash : undefined,
      });
    }
    manifest.models[request.pair] = {
      from: model.sourceLanguage,
      to: model.targetLanguage,
      architecture: model.architecture,
      releaseStatus: model.releaseStatus,
      metrics: model.metrics ?? null,
      parts: installedParts,
    };
  }

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const totalBytes = Object.values(manifest.models).reduce(
    (modelTotal, model) =>
      modelTotal +
      Object.values(model.parts).reduce((partTotal, part) => partTotal + part.uncompressedBytes, 0),
    0,
  );
  console.log(`Installed ${Object.keys(manifest.models).join(', ')} at ${MODELS_DIRECTORY}`);
  console.log(`Uncompressed model data: ${(totalBytes / 1024 / 1024).toFixed(1)} MiB`);
}

await main();
