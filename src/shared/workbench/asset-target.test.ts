import { describe, expect, it } from 'vitest';

import { isAssetTarget, parseAssetTarget } from './asset-target';

describe('AssetTarget', () => {
  it('uses Target terminology for new values', () => {
    const target = {
      scope: 'content',
      targetType: 'pdf.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 2 },
    };

    expect(isAssetTarget(target)).toBe(true);
    expect(parseAssetTarget(target)).toEqual(target);
  });

  it('normalizes pre-Target values only at compatibility boundaries', () => {
    expect(
      parseAssetTarget({
        scope: 'content',
        anchorType: 'pdf.page',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 2 },
      }),
    ).toEqual({
      scope: 'content',
      targetType: 'pdf.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 2 },
    });
  });

  it('rejects ambiguous wire values with undeclared fields', () => {
    expect(isAssetTarget({ scope: 'asset', targetType: 'pdf.page' })).toBe(
      false,
    );
    expect(
      isAssetTarget({
        scope: 'content',
        targetType: 'pdf.page',
        targetVersion: 1,
        targetPayload: { pageNumber: 2 },
        anchorType: 'pdf.page',
      }),
    ).toBe(false);
  });
});
