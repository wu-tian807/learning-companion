import { describe, expect, it } from 'vitest';

import {
  validateGenerationAssetReferenceBindings,
  validatePreparedGenerationAssetReferenceBindings,
} from './generation-asset-reference';

const schema = {
  sources: {
    required: true,
    cardinality: 'many' as const,
    minItems: 1,
    acceptedMediaTypes: ['text/markdown'],
  },
};

describe('generation AssetReference contracts', () => {
  it('validates required slots and rejects duplicate Asset ids', () => {
    expect(
      validateGenerationAssetReferenceBindings(schema, {
        sources: [{ assetId: 'asset-1' }],
      }),
    ).toEqual({ sources: [{ assetId: 'asset-1' }] });
    expect(() =>
      validateGenerationAssetReferenceBindings(schema, {}),
    ).toThrow('数量');
    expect(() =>
      validateGenerationAssetReferenceBindings(schema, {
        sources: [{ assetId: 'asset-1' }, { assetId: 'asset-1' }],
      }),
    ).toThrow('重复');
  });

  it('validates prepared aliases, relative paths, and media types', () => {
    const reference = {
      alias: 'sources-0001',
      assetId: 'asset-1',
      name: 'lesson.md',
      mediaType: 'text/markdown',
      contentRevision: 'revision',
      relativePath: 'references/sources-0001/source.md',
    };

    expect(
      validatePreparedGenerationAssetReferenceBindings(schema, {
        sources: [reference],
      }),
    ).toEqual({ sources: [reference] });
    expect(() =>
      validatePreparedGenerationAssetReferenceBindings(schema, {
        sources: [
          reference,
          {
            ...reference,
            assetId: 'asset-2',
          },
        ],
      }),
    ).toThrow('alias 重复');
    expect(() =>
      validatePreparedGenerationAssetReferenceBindings(schema, {
        sources: [{ ...reference, mediaType: 'application/pdf' }],
      }),
    ).toThrow('mediaType');
  });
});
