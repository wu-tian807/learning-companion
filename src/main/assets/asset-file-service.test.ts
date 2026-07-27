import { describe, expect, it, vi } from 'vitest';

import { createAssetSnapshot } from './asset';
import { createLocalFileContentLocator } from './asset-content-locator';
import type { AssetDatabaseApi } from './asset-database';
import { AssetFileService } from './asset-file-service';

function createAsset(availability: 'available' | 'missing') {
  return createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '学习资料',
    mediaType: 'text/markdown',
    contentLocator: createLocalFileContentLocator({
      path: '/tmp/notes.md',
      availability,
      checkedTime: new Date('2026-07-27T02:00:00.000Z'),
    }),
    createdTime: new Date('2026-07-27T01:00:00.000Z'),
    lastUsedTime: new Date('2026-07-27T03:00:00.000Z'),
  });
}

describe('AssetFileService', () => {
  it('reveals an available Asset using its trusted stored path', () => {
    const showItemInFolder = vi.fn();
    const assetDatabase = {
      get: vi.fn(() => createAsset('available')),
    } as unknown as AssetDatabaseApi;
    const service = new AssetFileService(assetDatabase, { showItemInFolder });

    service.revealInFolder('asset');

    expect(assetDatabase.get).toHaveBeenCalledWith('asset');
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/notes.md');
  });

  it('rejects missing and unknown Assets', () => {
    const showItemInFolder = vi.fn();
    const missingDatabase = {
      get: vi.fn(() => createAsset('missing')),
    } as unknown as AssetDatabaseApi;
    const unknownDatabase = {
      get: vi.fn(() => undefined),
    } as unknown as AssetDatabaseApi;

    expect(() =>
      new AssetFileService(missingDatabase, {
        showItemInFolder,
      }).revealInFolder('asset'),
    ).toThrow('ASSET_UNAVAILABLE');
    expect(() =>
      new AssetFileService(unknownDatabase, {
        showItemInFolder,
      }).revealInFolder('asset'),
    ).toThrow('ASSET_NOT_FOUND');
    expect(showItemInFolder).not.toHaveBeenCalled();
  });
});
