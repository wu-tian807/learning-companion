import { describe, expect, it } from 'vitest';

import type { AssetSnapshot } from '../shared/assets';
import {
  replaceAsset,
  selectAfterAssetDeletion,
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
    contentRef: {
      kind: 'local-file',
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
