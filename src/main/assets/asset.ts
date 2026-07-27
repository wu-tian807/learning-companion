import {
  cloneAsset as cloneSharedAsset,
  type AssetContentRef,
  type Asset,
} from '../../shared/assets';

export interface AssetInput {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly contentRef: AssetContentRef;
  readonly createdTime: number;
  readonly lastUsedTime: number;
}

export interface CreateAssetInput {
  readonly name: string;
  readonly mediaType: string;
  readonly contentRef: AssetContentRef;
}

export interface UpdateAssetInput {
  readonly name?: string;
  readonly lastUsedTime?: number;
}

export function createAssetSnapshot(input: AssetInput): Asset {
  return cloneSharedAsset(input);
}

export function cloneAsset(asset: Asset): Asset {
  return cloneSharedAsset(asset);
}

export type { Asset };
