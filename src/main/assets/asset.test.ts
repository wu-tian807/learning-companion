import { describe, expect, it } from 'vitest';

import { createAbsoluteLocalFileContentRef } from '../content/content-ref';
import { cloneAsset, createAssetSnapshot } from './asset';

function createValidAsset() {
  return createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '学习资料',
    mediaType: 'application/pdf',
    creationKind: 'imported',
    contentRef: createAbsoluteLocalFileContentRef('/tmp/paper.pdf'),
    createdTime: Date.parse('2026-07-24T01:00:00.000Z'),
    updatedTime: Date.parse('2026-07-24T01:00:00.000Z'),
  });
}

describe('Asset', () => {
  it('creates a normalized frozen snapshot', () => {
    const asset = createAssetSnapshot({
      ...createValidAsset(),
      id: ' asset ',
      projectId: ' project ',
      name: ' 学习资料 ',
      mediaType: ' application/pdf ',
    });

    expect(asset).toMatchObject({
      id: 'asset',
      projectId: 'project',
      name: '学习资料',
      mediaType: 'application/pdf',
    });
    expect(Object.isFrozen(asset)).toBe(true);
    expect(Object.isFrozen(asset.contentRef)).toBe(true);
  });

  it('does not expose nested content ref references', () => {
    const asset = createValidAsset();
    const clone = cloneAsset(asset);

    expect(cloneAsset(asset)).toEqual(createValidAsset());
    expect(clone.contentRef).not.toBe(asset.contentRef);
  });

  it('rejects empty identity, invalid MIME and invalid dates', () => {
    const valid = createValidAsset();

    expect(() => createAssetSnapshot({ ...valid, id: ' ' })).toThrow(
      'Asset 数据无效',
    );
    expect(() =>
      createAssetSnapshot({ ...valid, projectId: ' ' }),
    ).toThrow('Asset 数据无效');
    expect(() => createAssetSnapshot({ ...valid, name: ' ' })).toThrow(
      'Asset 数据无效',
    );
    expect(() =>
      createAssetSnapshot({ ...valid, mediaType: 'pdf' }),
    ).toThrow('Asset 数据无效');
    expect(() =>
      createAssetSnapshot({
        ...valid,
        createdTime: Number.NaN,
      }),
    ).toThrow('Asset 数据无效');
  });
});
