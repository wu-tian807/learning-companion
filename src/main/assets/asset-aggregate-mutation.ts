export interface AssetAggregateMutation {
  readonly projectId: string;
  readonly assetId: string;
  readonly updatedTime: number;
}

export type AssetAggregateMutationListener = (
  mutation: AssetAggregateMutation,
) => void | Promise<void>;

export interface AssetAggregateMutationSource {
  subscribeAssetMutations(
    listener: AssetAggregateMutationListener,
  ): () => void;
}

export interface AssetAggregateTouchPort {
  touch(projectId: string, assetId: string, updatedTime: number): void;
}

export function trackAssetAggregateMutations(
  assets: AssetAggregateTouchPort,
  sources: readonly AssetAggregateMutationSource[],
): () => void {
  const disposers: Array<() => void> = [];

  try {
    for (const source of sources) {
      disposers.push(
        source.subscribeAssetMutations((mutation) => {
          try {
            assets.touch(
              mutation.projectId,
              mutation.assetId,
              mutation.updatedTime,
            );
          } catch (error) {
            console.error('同步 Asset 聚合更新时间失败', {
              ...mutation,
              error,
            });
          }
        }),
      );
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) {
      dispose();
    }
    throw error;
  }

  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const dispose of disposers.reverse()) {
      dispose();
    }
  };
}
