import { describe, expect, it } from 'vitest';

import {
  cloneAsset,
  cloneAssetSnapshot,
  createLocalFileContentRef,
  createManagedJsonContentRef,
  isAsset,
  isAssetContentRef,
  isAssetSnapshot,
  isAssetSnapshotList,
} from './assets';

const asset = {
  id: 'asset',
  projectId: 'project',
  name: '学习笔记',
  mediaType: 'text/markdown',
  contentRef: {
    kind: 'local-file',
    path: '/tmp/notes.md',
  },
  createdTime: 1_753_168_400_000,
  lastUsedTime: 1_753_172_000_000,
} as const;

describe('Asset shared contract', () => {
  it('validates both supported ContentRef variants', () => {
    expect(isAssetContentRef(asset.contentRef)).toBe(true);
    expect(isAssetContentRef({ kind: 'managed-json', contentId: 'mindmap' })).toBe(
      true,
    );
    expect(createLocalFileContentRef(' /tmp/notes.md ')).toEqual(
      asset.contentRef,
    );
    expect(createManagedJsonContentRef(' mindmap ')).toEqual({
      kind: 'managed-json',
      contentId: 'mindmap',
    });
  });

  it('validates and deeply clones Asset entities', () => {
    const clone = cloneAsset(asset);

    expect(isAsset(clone)).toBe(true);
    expect(clone).toEqual(asset);
    expect(clone).not.toBe(asset);
    expect(clone.contentRef).not.toBe(asset.contentRef);
    expect(Object.isFrozen(clone)).toBe(true);
    expect(Object.isFrozen(clone.contentRef)).toBe(true);
  });

  it('validates Asset snapshots', () => {
    const snapshot = {
      ...asset,
      contentStatus: {
        availability: 'available',
        checkedTime: 1_753_172_000_000,
      },
    } as const;

    expect(isAssetSnapshot(snapshot)).toBe(true);
    expect(isAssetSnapshotList([snapshot])).toBe(true);
    expect(cloneAssetSnapshot(snapshot)).toEqual(snapshot);
  });

  it('rejects malformed content, media and runtime status', () => {
    expect(isAssetContentRef({ kind: 'local-file', path: '' })).toBe(false);
    expect(
      isAssetContentRef({ kind: 'managed-json', contentId: '' }),
    ).toBe(false);
    expect(isAssetContentRef({ kind: 'remote-url', url: 'https://x.test' })).toBe(
      false,
    );
    expect(isAsset({ ...asset, mediaType: 'markdown' })).toBe(false);
    expect(isAsset({ ...asset, createdTime: -1 })).toBe(false);
    expect(
      isAssetSnapshot({
        ...asset,
        contentStatus: {
          availability: 'offline',
          checkedTime: 1_753_172_000_000,
        },
      }),
    ).toBe(false);
    expect(isAssetSnapshotList([{ ...asset, contentStatus: null }])).toBe(false);
  });
});
