import { describe, expect, it } from 'vitest';

import {
  cloneAssetArtifact,
  cloneAssetArtifactKey,
  isAssetArtifact,
} from './asset-artifact';

const validArtifact = {
  assetId: 'asset',
  producerId: 'builtin.office.preview',
  artifactKey: 'preview',
  relativePath:
    '.learning-companion/artifacts/asset/builtin.office.preview/revision.pdf',
  mediaType: 'application/pdf',
  sourceRevision: 'source-revision',
  producerVersion: 'office-preview@1+libreoffice@1',
  artifactRevision: 'artifact-revision',
  updatedTime: Date.parse('2026-07-30T03:00:00.000Z'),
} as const;

describe('AssetArtifact', () => {
  it('clones and freezes valid pure data', () => {
    const artifact = cloneAssetArtifact({
      ...validArtifact,
      assetId: ' asset ',
      producerId: ' builtin.office.preview ',
    });

    expect(artifact).toEqual(validArtifact);
    expect(Object.isFrozen(artifact)).toBe(true);
  });

  it('validates portable relative paths and media types', () => {
    expect(isAssetArtifact(validArtifact)).toBe(true);
    expect(
      isAssetArtifact({ ...validArtifact, relativePath: '../preview.pdf' }),
    ).toBe(false);
    expect(
      isAssetArtifact({ ...validArtifact, relativePath: 'C:\\preview.pdf' }),
    ).toBe(false);
    expect(
      isAssetArtifact({ ...validArtifact, mediaType: 'pdf' }),
    ).toBe(false);
    expect(
      isAssetArtifact({ ...validArtifact, updatedTime: -1 }),
    ).toBe(false);
  });

  it('rejects empty stable keys', () => {
    expect(() =>
      cloneAssetArtifactKey({
        assetId: 'asset',
        producerId: ' ',
        artifactKey: 'preview',
      }),
    ).toThrow('AssetArtifactKey 数据无效');
  });
});
