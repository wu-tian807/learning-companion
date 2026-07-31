import { describe, expect, it } from 'vitest';

import {
  cloneAsset,
  cloneAssetSnapshot,
  createAbsoluteLocalFileContentRef,
  createProjectWorkspaceContentRef,
  isAsset,
  isAssetCreationKind,
  isAssetContentRef,
  isAssetSnapshot,
  isAssetSnapshotList,
} from './assets';

const asset = {
  id: 'asset',
  projectId: 'project',
  name: '学习笔记',
  mediaType: 'text/markdown',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/tmp/notes.md',
  },
  createdTime: 1_753_168_400_000,
  lastUsedTime: 1_753_172_000_000,
} as const;

describe('Asset shared contract', () => {
  it('validates absolute and Project Workspace file references', () => {
    expect(isAssetContentRef(asset.contentRef)).toBe(true);
    expect(createAbsoluteLocalFileContentRef(' /tmp/notes.md ')).toEqual(
      asset.contentRef,
    );
    expect(
      createProjectWorkspaceContentRef('assets/imported/notes.md'),
    ).toEqual({
      kind: 'local-file',
      base: 'project-workspace',
      path: 'assets/imported/notes.md',
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

  it('accepts only the supported Asset creation kinds', () => {
    expect(isAssetCreationKind('imported')).toBe(true);
    expect(isAssetCreationKind('generated')).toBe(true);
    expect(isAssetCreationKind('authored')).toBe(false);
    expect(isAsset({ ...asset, creationKind: 'authored' })).toBe(false);
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
    expect(
      isAssetContentRef({
        kind: 'local-file',
        base: 'absolute',
        path: '',
      }),
    ).toBe(false);
    expect(
      isAssetContentRef({
        kind: 'local-file',
        base: 'project-workspace',
        path: '../outside.md',
      }),
    ).toBe(false);
    expect(
      isAssetContentRef({
        kind: 'local-file',
        base: 'project-workspace',
        path: 'assets\\notes.md',
      }),
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
