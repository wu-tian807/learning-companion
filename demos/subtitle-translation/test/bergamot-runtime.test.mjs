import test from 'node:test';
import assert from 'node:assert/strict';
import { validateModelManifest } from '../src/bergamot-runtime.mjs';

test('accepts a manifest with shared or split vocabularies', () => {
  const basePart = { path: 'file.bin', sha256: 'abc' };
  const manifest = {
    schemaVersion: 1,
    models: {
      'en-zh': {
        from: 'en',
        to: 'zh',
        parts: {
          model: basePart,
          shortlist: basePart,
          srcVocab: basePart,
          trgVocab: basePart,
        },
      },
      'zh-en': {
        from: 'zh',
        to: 'en',
        parts: { model: basePart, shortlist: basePart, vocab: basePart },
      },
    },
  };
  assert.equal(validateModelManifest(manifest), manifest);
});

test('rejects a model without vocabulary files', () => {
  assert.throws(
    () =>
      validateModelManifest({
        schemaVersion: 1,
        models: {
          'en-zh': {
            from: 'en',
            to: 'zh',
            parts: { model: {}, shortlist: {} },
          },
        },
      }),
    /vocabulary/u,
  );
});
