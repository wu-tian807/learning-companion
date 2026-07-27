import { AppError } from '../errors/app-error';

export type AssetRelationType =
  | 'derived-from'
  | 'references'
  | 'supersedes';

export interface AssetRelation {
  readonly id: string;
  readonly projectId: string;
  readonly fromAssetId: string;
  readonly toAssetId: string;
  readonly relationType: AssetRelationType;
  readonly createdTime: number;
}

export interface AssetRelationServiceApi {
  listByAsset(assetId: string): Promise<readonly AssetRelation[]>;
  create(relation: AssetRelation): Promise<AssetRelation>;
  delete(relationId: string): Promise<void>;
}

export class EmptyAssetRelationService implements AssetRelationServiceApi {
  async listByAsset(_assetId: string): Promise<readonly AssetRelation[]> {
    void _assetId;
    return [];
  }

  async create(_relation: AssetRelation): Promise<AssetRelation> {
    void _relation;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async delete(_relationId: string): Promise<void> {
    void _relationId;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }
}
