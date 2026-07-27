import {
  cloneAssetContentRef,
  type AssetContentRef,
} from '../content/content-ref';

export interface Asset {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly contentRef: AssetContentRef;
  readonly createdTime: Date;
  readonly lastUsedTime: Date;
}

export interface AssetInput {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly contentRef: AssetContentRef;
  readonly createdTime: Date;
  readonly lastUsedTime: Date;
}

export interface CreateAssetInput {
  readonly name: string;
  readonly mediaType: string;
  readonly contentRef: AssetContentRef;
}

export interface UpdateAssetInput {
  readonly name?: string;
  readonly lastUsedTime?: Date;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Asset ${field} 不能为空`);
  }

  return normalized;
}

function requireDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Asset ${field} 必须是有效日期`);
  }

  return new Date(value.getTime());
}

function requireMediaType(value: string): string {
  const mediaType = requireText(value, 'mediaType');

  if (!/^[^\s/]+\/[^\s/]+$/.test(mediaType)) {
    throw new Error('Asset mediaType 必须是标准 MIME');
  }

  return mediaType;
}

export function createAssetSnapshot(input: AssetInput): Asset {
  return Object.freeze({
    id: requireText(input.id, 'id'),
    projectId: requireText(input.projectId, 'projectId'),
    name: requireText(input.name, 'name'),
    mediaType: requireMediaType(input.mediaType),
    contentRef: cloneAssetContentRef(input.contentRef),
    createdTime: requireDate(input.createdTime, 'createdTime'),
    lastUsedTime: requireDate(input.lastUsedTime, 'lastUsedTime'),
  });
}

export function cloneAsset(asset: Asset): Asset {
  return createAssetSnapshot(asset);
}
