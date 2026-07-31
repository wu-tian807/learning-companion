import { describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../shared/assets';
import {
  assetSourceBadgeLabel,
  deleteAssetAfterWorkbenchClose,
  deleteAssetsAfterWorkbenchClose,
  replaceAsset,
  selectAfterAssetDeletion,
  selectAfterAssetsDeletion,
  selectInitialAssetId,
} from './asset-view';

function timestamp(value: string): number {
  return Date.parse(value);
}

function asset(
  id: string,
  availability: AssetSnapshot['contentStatus']['availability'],
  lastUsedTime: number,
): AssetSnapshot {
  return {
    id,
    projectId: 'project',
    name: id,
    mediaType: 'text/markdown',
    creationKind: 'imported',
    contentRef: {
      kind: 'local-file',
      base: 'absolute',
      path: `/tmp/${id}.md`,
    },
    contentStatus: {
      availability,
      checkedTime: timestamp('2026-07-27T01:00:00.000Z'),
    },
    createdTime: timestamp('2026-07-27T01:00:00.000Z'),
    lastUsedTime,
  };
}

describe('Asset view state', () => {
  it('labels only local files outside the Project Workspace as external', () => {
    expect(
      assetSourceBadgeLabel({
        kind: 'local-file',
        base: 'absolute',
        path: '/tmp/external.md',
      }),
    ).toBe('外部');
    expect(
      assetSourceBadgeLabel({
        kind: 'local-file',
        base: 'project-workspace',
        path: 'assets/imported/internal.md',
      }),
    ).toBeUndefined();
  });

  it('selects the most recently used available Asset first', () => {
    const assets = [
      asset('older', 'available', timestamp('2026-07-27T01:00:00.000Z')),
      asset(
        'newest-missing',
        'missing',
        timestamp('2026-07-27T03:00:00.000Z'),
      ),
      asset('newer', 'available', timestamp('2026-07-27T02:00:00.000Z')),
    ];

    expect(selectInitialAssetId(assets)).toBe('newer');
    expect(
      selectInitialAssetId([
        asset(
          'missing',
          'missing',
          timestamp('2026-07-27T01:00:00.000Z'),
        ),
      ]),
    ).toBe('missing');
    expect(selectInitialAssetId([])).toBeNull();
  });

  it('selects the next or previous neighbor after deleting the current Asset', () => {
    const assets = [
      asset('a', 'available', timestamp('2026-07-27T01:00:00.000Z')),
      asset('b', 'available', timestamp('2026-07-27T02:00:00.000Z')),
      asset('c', 'available', timestamp('2026-07-27T03:00:00.000Z')),
    ];

    expect(selectAfterAssetDeletion(assets, 'b', 'b')).toBe('c');
    expect(selectAfterAssetDeletion(assets, 'c', 'c')).toBe('b');
    expect(selectAfterAssetDeletion(assets, 'b', 'a')).toBe('a');
    expect(selectAfterAssetDeletion([assets[0]!], 'a', 'a')).toBeNull();
  });

  it('selects the nearest surviving neighbor after deleting multiple Assets', () => {
    const assets = [
      asset('a', 'available', timestamp('2026-07-27T01:00:00.000Z')),
      asset('b', 'available', timestamp('2026-07-27T02:00:00.000Z')),
      asset('c', 'available', timestamp('2026-07-27T03:00:00.000Z')),
      asset('d', 'available', timestamp('2026-07-27T04:00:00.000Z')),
    ];

    expect(selectAfterAssetsDeletion(assets, ['b', 'c'], 'b')).toBe('d');
    expect(selectAfterAssetsDeletion(assets, ['c', 'd'], 'c')).toBe('b');
    expect(selectAfterAssetsDeletion(assets, ['a', 'b'], 'd')).toBe('d');
    expect(
      selectAfterAssetsDeletion(assets, ['a', 'b', 'c', 'd'], 'b'),
    ).toBeNull();
  });

  it('deselects and waits for the current Workbench before deleting its Asset', async () => {
    let releaseWorkbench!: () => void;
    const workbenchClosed = new Promise<void>((resolve) => {
      releaseWorkbench = resolve;
    });
    const deselect = vi.fn();
    const deleteAsset = vi.fn(async () => undefined);
    const deletion = deleteAssetAfterWorkbenchClose(
      'asset',
      'asset',
      workbenchClosed,
      deselect,
      deleteAsset,
    );

    await Promise.resolve();
    expect(deselect).toHaveBeenCalledOnce();
    expect(deleteAsset).not.toHaveBeenCalled();

    releaseWorkbench();
    await deletion;
    expect(deleteAsset).toHaveBeenCalledOnce();
  });

  it('does not disturb another active Workbench when deleting a background Asset', async () => {
    const deselect = vi.fn();
    const deleteAsset = vi.fn(async () => undefined);

    await expect(
      deleteAssetAfterWorkbenchClose(
        'selected',
        'background',
        new Promise<void>(() => undefined),
        deselect,
        deleteAsset,
      ),
    ).resolves.toBeUndefined();
    expect(deselect).not.toHaveBeenCalled();
    expect(deleteAsset).toHaveBeenCalledOnce();
  });

  it('closes the active Workbench once when it belongs to a deletion batch', async () => {
    let releaseWorkbench!: () => void;
    const workbenchClosed = new Promise<void>((resolve) => {
      releaseWorkbench = resolve;
    });
    const deselect = vi.fn();
    const deleteAssets = vi.fn(async () => undefined);
    const deletion = deleteAssetsAfterWorkbenchClose(
      'b',
      ['a', 'b', 'c'],
      workbenchClosed,
      deselect,
      deleteAssets,
    );

    await Promise.resolve();
    expect(deselect).toHaveBeenCalledOnce();
    expect(deleteAssets).not.toHaveBeenCalled();

    releaseWorkbench();
    await deletion;
    expect(deleteAssets).toHaveBeenCalledOnce();
  });

  it('replaces only the matching Asset snapshot', () => {
    const first = asset(
      'a',
      'available',
      timestamp('2026-07-27T01:00:00.000Z'),
    );
    const second = asset(
      'b',
      'missing',
      timestamp('2026-07-27T02:00:00.000Z'),
    );
    const updated = { ...second, name: '新标题' };

    expect(replaceAsset([first, second], updated)).toEqual([first, updated]);
  });
});
