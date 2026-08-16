import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BatchTranslator,
  TranslatorBacking,
} from '@browsermt/bergamot-translator/translator.js';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MODELS_DIRECTORY = resolve(SOURCE_DIRECTORY, '..', '.models', 'bergamot');

function exactArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function readVerifiedPart(modelsDirectory, part) {
  const buffer = await readFile(resolve(modelsDirectory, part.path));
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== part.sha256) {
    throw new Error(`Bergamot model checksum mismatch: ${part.path}`);
  }
  return exactArrayBuffer(buffer);
}

export function validateModelManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || typeof manifest.models !== 'object' || manifest.models === null) {
    throw new Error('Invalid Bergamot model manifest. Run pnpm setup:bergamot first.');
  }
  for (const [pair, model] of Object.entries(manifest.models)) {
    if (!model?.from || !model?.to || !model?.parts?.model || !model?.parts?.shortlist) {
      throw new Error(`Invalid Bergamot model entry: ${pair}`);
    }
    const vocabParts = model.parts.vocab
      ? [model.parts.vocab]
      : [model.parts.srcVocab, model.parts.trgVocab];
    if (vocabParts.some((part) => !part)) {
      throw new Error(`Bergamot model ${pair} has no usable vocabulary.`);
    }
  }
  return manifest;
}

class LocalBergamotBacking extends TranslatorBacking {
  async loadModelRegistery() {
    const modelsDirectory = this.options.modelsDirectory;
    const manifest = validateModelManifest(
      JSON.parse(await readFile(resolve(modelsDirectory, 'manifest.json'), 'utf8')),
    );
    return Object.entries(manifest.models).map(([pair, model]) => ({ pair, ...model }));
  }

  async loadTranslationModel({ from, to }) {
    const modelsDirectory = this.options.modelsDirectory;
    const entries = (await this.registry).filter((model) => model.from === from && model.to === to);
    const selected = entries[0];
    if (!selected) throw new Error(`No installed Bergamot model for ${from}->${to}.`);
    const parts = selected.parts;
    const vocabParts = parts.vocab ? [parts.vocab] : [parts.srcVocab, parts.trgVocab];
    const [model, shortlist, ...vocabs] = await Promise.all([
      readVerifiedPart(modelsDirectory, parts.model),
      readVerifiedPart(modelsDirectory, parts.shortlist),
      ...vocabParts.map((part) => readVerifiedPart(modelsDirectory, part)),
    ]);
    return { model, shortlist, vocabs, config: {} };
  }
}

export function createLocalBergamotTranslator({
  modelsDirectory = DEFAULT_MODELS_DIRECTORY,
  workers = 1,
  batchSize = 8,
  cacheSize = 256,
} = {}) {
  const options = {
    modelsDirectory,
    workers,
    batchSize,
    cacheSize,
    pivotLanguage: null,
    downloadTimeout: 0,
  };
  const backing = new LocalBergamotBacking(options);
  return new BatchTranslator(options, backing);
}
