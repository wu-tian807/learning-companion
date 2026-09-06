import { describe, expect, it } from 'vitest';

import {
  cloneAssetLink,
  cloneAssetLinkTarget,
  cloneAssetReference,
  cloneAssetReferenceTarget,
  isAssetLink,
  isAssetLinkTarget,
  isAssetReference,
  isAssetReferenceTarget,
} from './asset-associations';

describe('AssetReference contract', () => {
  it('records one Asset-level source without format-specific targets', () => {
    const reference = cloneAssetReference({
      id: ' reference ',
      projectId: ' project ',
      assetId: ' mindmap ',
      sourceAssetId: ' pdf ',
      createdTime: 1_785_513_600_000,
    });

    expect(reference).toEqual({
      id: 'reference',
      projectId: 'project',
      assetId: 'mindmap',
      sourceAssetId: 'pdf',
      createdTime: 1_785_513_600_000,
    });
  });

  it('rejects incomplete and self references', () => {
    expect(
      isAssetReference({
        id: 'reference',
        projectId: 'project',
        assetId: 'mindmap',
        sourceAssetId: '',
        createdTime: 1,
      }),
    ).toBe(false);
    expect(
      isAssetReference({
        id: 'reference',
        projectId: 'project',
        assetId: 'mindmap',
        sourceAssetId: 'mindmap',
        createdTime: 1,
      }),
    ).toBe(false);
  });
});

describe('AssetLink contract', () => {
  it('records one directed Asset-level link', () => {
    const link = cloneAssetLink({
      id: ' link ',
      projectId: ' project ',
      assetId: ' mindmap ',
      targetAssetId: ' lecture ',
      createdTime: 1_785_513_600_001,
    });

    expect(link).toEqual({
      id: 'link',
      projectId: 'project',
      assetId: 'mindmap',
      targetAssetId: 'lecture',
      createdTime: 1_785_513_600_001,
    });
    expect(isAssetLink(link)).toBe(true);
  });

  it('rejects incomplete and self links', () => {
    expect(
      isAssetLink({
        id: 'link',
        projectId: 'project',
        assetId: 'mindmap',
        targetAssetId: '   ',
        createdTime: 1,
      }),
    ).toBe(false);
    expect(
      isAssetLink({
        id: 'link',
        projectId: 'project',
        assetId: 'mindmap',
        targetAssetId: 'mindmap',
        createdTime: 1,
      }),
    ).toBe(false);
  });
});

describe('Asset association Target bindings', () => {
  const target = {
    scope: 'content' as const,
    targetType: 'pdf.page',
    targetVersion: 1,
    targetPayload: { pageNumber: 2 },
  };

  it('wraps a Reference Target without changing the Asset-level relation', () => {
    const binding = cloneAssetReferenceTarget({
      referenceId: ' reference ',
      contentRevision: ' revision ',
      target,
    });

    expect(binding).toEqual({
      referenceId: 'reference',
      contentRevision: 'revision',
      target,
    });
    expect(isAssetReferenceTarget(binding)).toBe(true);
    expect(binding.target).not.toBe(target);
  });

  it('wraps a Link Target and rejects an unscoped or incomplete binding', () => {
    const binding = cloneAssetLinkTarget({
      linkId: 'link',
      contentRevision: 'revision',
      target: { scope: 'asset' },
    });

    expect(isAssetLinkTarget(binding)).toBe(true);
    expect(isAssetLinkTarget({
      linkId: 'link',
      target,
    })).toBe(false);
    expect(isAssetReferenceTarget({
      referenceId: 'reference',
      contentRevision: 'revision',
      target,
      extra: true,
    })).toBe(false);
  });
});
