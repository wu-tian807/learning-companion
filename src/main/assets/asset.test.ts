import { describe, expect, it } from 'vitest';

import { createLocalFileContentLocator } from './asset-content-locator';
import { cloneAsset, createAssetSnapshot } from './asset';

function createValidAsset() {
  return createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '学习资料',
    mediaType: 'application/pdf',
    contentLocator: createLocalFileContentLocator({
      path: '/tmp/paper.pdf',
      availability: 'available',
      checkedTime: new Date('2026-07-24T02:00:00.000Z'),
    }),
    createdTime: new Date('2026-07-24T01:00:00.000Z'),
    lastUsedTime: new Date('2026-07-24T01:00:00.000Z'),
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
    expect(Object.isFrozen(asset.contentLocator)).toBe(true);
  });

  it('does not expose nested locator or Date references', () => {
    const asset = createValidAsset();
    const clone = cloneAsset(asset);

    clone.createdTime.setTime(0);
    clone.lastUsedTime.setTime(0);
    clone.contentLocator.checkedTime.setTime(0);

    expect(cloneAsset(asset)).toEqual(createValidAsset());
  });

  it('rejects empty identity, invalid MIME and invalid dates', () => {
    const valid = createValidAsset();

    expect(() => createAssetSnapshot({ ...valid, id: ' ' })).toThrow(
      'Asset id 不能为空',
    );
    expect(() =>
      createAssetSnapshot({ ...valid, projectId: ' ' }),
    ).toThrow('Asset projectId 不能为空');
    expect(() => createAssetSnapshot({ ...valid, name: ' ' })).toThrow(
      'Asset name 不能为空',
    );
    expect(() =>
      createAssetSnapshot({ ...valid, mediaType: 'pdf' }),
    ).toThrow('Asset mediaType 必须是标准 MIME');
    expect(() =>
      createAssetSnapshot({
        ...valid,
        createdTime: new Date(Number.NaN),
      }),
    ).toThrow('Asset createdTime 必须是有效日期');
  });
});
