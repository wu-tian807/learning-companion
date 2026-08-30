import { describe, expect, it, vi } from 'vitest';

import {
  trackAssetAggregateMutations,
  type AssetAggregateMutation,
  type AssetAggregateMutationListener,
  type AssetAggregateMutationSource,
} from './asset-aggregate-mutation';

function createSource() {
  const listeners = new Set<AssetAggregateMutationListener>();
  const source: AssetAggregateMutationSource = {
    subscribeAssetMutations: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return {
    source,
    emit(mutation: AssetAggregateMutation) {
      for (const listener of listeners) {
        void listener(mutation);
      }
    },
  };
}

describe('Asset aggregate mutation tracking', () => {
  it('routes every source through one Asset touch port and disposes idempotently', () => {
    const first = createSource();
    const second = createSource();
    const assets = { touch: vi.fn() };
    const dispose = trackAssetAggregateMutations(assets, [
      first.source,
      second.source,
    ]);

    first.emit({ projectId: 'project', assetId: 'asset-a', updatedTime: 10 });
    second.emit({ projectId: 'project', assetId: 'asset-b', updatedTime: 20 });

    expect(assets.touch).toHaveBeenNthCalledWith(
      1,
      'project',
      'asset-a',
      10,
    );
    expect(assets.touch).toHaveBeenNthCalledWith(
      2,
      'project',
      'asset-b',
      20,
    );

    dispose();
    dispose();
    first.emit({ projectId: 'project', assetId: 'asset-a', updatedTime: 30 });
    expect(assets.touch).toHaveBeenCalledTimes(2);
  });

  it('contains update failures after the aggregate mutation has committed', () => {
    const source = createSource();
    const failure = new Error('touch failed');
    const assets = {
      touch: vi.fn(() => {
        throw failure;
      }),
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispose = trackAssetAggregateMutations(assets, [source.source]);

    source.emit({ projectId: 'project', assetId: 'asset', updatedTime: 10 });

    expect(error).toHaveBeenCalledWith('同步 Asset 聚合更新时间失败', {
      projectId: 'project',
      assetId: 'asset',
      updatedTime: 10,
      error: failure,
    });
    dispose();
    error.mockRestore();
  });

  it('rolls back earlier subscriptions when setup fails', () => {
    const first = createSource();
    const unsubscribe = vi.fn();
    vi.mocked(first.source.subscribeAssetMutations).mockReturnValueOnce(
      unsubscribe,
    );
    const failure = new Error('subscribe failed');
    const second: AssetAggregateMutationSource = {
      subscribeAssetMutations: () => {
        throw failure;
      },
    };

    expect(() =>
      trackAssetAggregateMutations({ touch: vi.fn() }, [first.source, second]),
    ).toThrow(failure);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
