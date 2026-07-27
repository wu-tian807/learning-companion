import { isUnixMilliseconds } from './projects';

export const ASSET_NAME_MAX_LENGTH = 160;
export const LOCAL_FILE_CONTENT_KIND = 'local-file';
export const MANAGED_JSON_CONTENT_KIND = 'managed-json';

export interface LocalFileContentRef {
  readonly kind: typeof LOCAL_FILE_CONTENT_KIND;
  readonly path: string;
}

export interface ManagedJsonContentRef {
  readonly kind: typeof MANAGED_JSON_CONTENT_KIND;
  readonly contentId: string;
}

export type AssetContentRef = LocalFileContentRef | ManagedJsonContentRef;
export type AssetContentKind = AssetContentRef['kind'];

export type AssetAvailability =
  | 'available'
  | 'missing'
  | 'inaccessible'
  | 'invalid';

export interface AssetContentStatus {
  readonly availability: AssetAvailability;
  readonly checkedTime: number;
}

export interface Asset {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly contentRef: AssetContentRef;
  readonly createdTime: number;
  readonly lastUsedTime: number;
}

export interface AssetSnapshot extends Asset {
  readonly contentStatus: AssetContentStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(
  value: unknown,
  maxCodePoints?: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    (maxCodePoints === undefined || [...value].length <= maxCodePoints)
  );
}

function isMediaType(value: unknown): value is string {
  return (
    isRequiredText(value) &&
    /^[^\s/]+\/[^\s/]+$/.test(value.trim())
  );
}

export function isAssetAvailability(
  value: unknown,
): value is AssetAvailability {
  return (
    value === 'available' ||
    value === 'missing' ||
    value === 'inaccessible' ||
    value === 'invalid'
  );
}

export function isAssetContentRef(value: unknown): value is AssetContentRef {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind === LOCAL_FILE_CONTENT_KIND) {
    return isRequiredText(value.path);
  }

  if (value.kind === MANAGED_JSON_CONTENT_KIND) {
    return isRequiredText(value.contentId);
  }

  return false;
}

export function isAssetContentStatus(
  value: unknown,
): value is AssetContentStatus {
  return (
    isRecord(value) &&
    isAssetAvailability(value.availability) &&
    isUnixMilliseconds(value.checkedTime)
  );
}

export function isAsset(value: unknown): value is Asset {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    isRequiredText(value.projectId) &&
    isRequiredText(value.name, ASSET_NAME_MAX_LENGTH) &&
    isMediaType(value.mediaType) &&
    isAssetContentRef(value.contentRef) &&
    isUnixMilliseconds(value.createdTime) &&
    isUnixMilliseconds(value.lastUsedTime)
  );
}

export function isAssetSnapshot(value: unknown): value is AssetSnapshot {
  return (
    isAsset(value) &&
    isRecord(value) &&
    isAssetContentStatus(value.contentStatus)
  );
}

export function isAssetSnapshotList(value: unknown): value is AssetSnapshot[] {
  return Array.isArray(value) && value.every(isAssetSnapshot);
}

export function createLocalFileContentRef(path: string): LocalFileContentRef {
  const contentRef = {
    kind: LOCAL_FILE_CONTENT_KIND,
    path: path.trim(),
  } as const;

  if (!isAssetContentRef(contentRef)) {
    throw new Error('LocalFileContentRef 数据无效');
  }

  return Object.freeze(contentRef);
}

export function createManagedJsonContentRef(
  contentId: string,
): ManagedJsonContentRef {
  const contentRef = {
    kind: MANAGED_JSON_CONTENT_KIND,
    contentId: contentId.trim(),
  } as const;

  if (!isAssetContentRef(contentRef)) {
    throw new Error('ManagedJsonContentRef 数据无效');
  }

  return Object.freeze(contentRef);
}

export function cloneAssetContentRef(
  contentRef: AssetContentRef,
): AssetContentRef {
  switch (contentRef.kind) {
    case LOCAL_FILE_CONTENT_KIND:
      return createLocalFileContentRef(contentRef.path);
    case MANAGED_JSON_CONTENT_KIND:
      return createManagedJsonContentRef(contentRef.contentId);
  }
}

export function cloneAssetContentStatus(
  contentStatus: AssetContentStatus,
): AssetContentStatus {
  if (!isAssetContentStatus(contentStatus)) {
    throw new Error('AssetContentStatus 数据无效');
  }

  return Object.freeze({
    availability: contentStatus.availability,
    checkedTime: contentStatus.checkedTime,
  });
}

export function cloneAsset(asset: Asset): Asset {
  if (!isAsset(asset)) {
    throw new Error('Asset 数据无效');
  }

  return Object.freeze({
    id: asset.id.trim(),
    projectId: asset.projectId.trim(),
    name: asset.name.trim(),
    mediaType: asset.mediaType.trim(),
    contentRef: cloneAssetContentRef(asset.contentRef),
    createdTime: asset.createdTime,
    lastUsedTime: asset.lastUsedTime,
  });
}

export function cloneAssetSnapshot(snapshot: AssetSnapshot): AssetSnapshot {
  if (!isAssetSnapshot(snapshot)) {
    throw new Error('AssetSnapshot 数据无效');
  }

  return Object.freeze({
    ...cloneAsset(snapshot),
    contentStatus: cloneAssetContentStatus(snapshot.contentStatus),
  });
}
