import { describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import {
  createAssetContentStatus,
  createLocalFileContentRef,
} from '../content/content-ref';
import { createAssetSnapshot } from './asset';
import { AssetFileService } from './asset-file-service';
import type { AssetServiceApi } from './asset-service';

function createAsset(
  availability: 'available' | 'missing',
): AssetSnapshot {
  const contentRef = createLocalFileContentRef('/tmp/notes.md');

  return {
    ...createAssetSnapshot({
      id: 'asset',
      projectId: 'project',
      name: '学习资料',
      mediaType: 'text/markdown',
      contentRef,
      createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
      lastUsedTime: Date.parse('2026-07-27T03:00:00.000Z'),
    }),
    contentStatus: createAssetContentStatus(
      availability,
      Date.parse('2026-07-27T02:00:00.000Z'),
    ),
  };
}

describe('AssetFileService', () => {
  it('reveals an available Asset using its trusted stored path', () => {
    const showItemInFolder = vi.fn();
    const assetService = {
      get: vi.fn(() => createAsset('available')),
    } as unknown as AssetServiceApi;
    const service = new AssetFileService(assetService, { showItemInFolder });

    service.revealInFolder('asset');

    expect(assetService.get).toHaveBeenCalledWith('asset');
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/notes.md');
  });

  it('rejects missing and unknown Assets', () => {
    const showItemInFolder = vi.fn();
    const missingService = {
      get: vi.fn(() => createAsset('missing')),
    } as unknown as AssetServiceApi;
    const unknownService = {
      get: vi.fn(() => undefined),
    } as unknown as AssetServiceApi;

    expect(() =>
      new AssetFileService(missingService, {
        showItemInFolder,
      }).revealInFolder('asset'),
    ).toThrow('ASSET_UNAVAILABLE');
    expect(() =>
      new AssetFileService(unknownService, {
        showItemInFolder,
      }).revealInFolder('asset'),
    ).toThrow('ASSET_NOT_FOUND');
    expect(showItemInFolder).not.toHaveBeenCalled();
  });
});
