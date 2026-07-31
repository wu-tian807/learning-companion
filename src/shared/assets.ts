import { isUnixMilliseconds } from './projects';
import { isAbsoluteFileSystemPath } from './projects';

export const ASSET_NAME_MAX_LENGTH = 160;
export const LOCAL_FILE_CONTENT_KIND = 'local-file';
export const PROJECT_WORKSPACE_CONTENT_BASE = 'project-workspace';
export const ABSOLUTE_CONTENT_BASE = 'absolute';
export type LocalAssetImportMode = 'copy' | 'link';
export type AssetCreationKind = 'imported' | 'generated';

export interface ProjectWorkspaceLocalFileContentRef {
  readonly kind: typeof LOCAL_FILE_CONTENT_KIND;
  readonly base: typeof PROJECT_WORKSPACE_CONTENT_BASE;
  readonly path: string;
}

export interface AbsoluteLocalFileContentRef {
  readonly kind: typeof LOCAL_FILE_CONTENT_KIND;
  readonly base: typeof ABSOLUTE_CONTENT_BASE;
  readonly path: string;
}

export type LocalFileContentRef =
  | ProjectWorkspaceLocalFileContentRef
  | AbsoluteLocalFileContentRef;
export type AssetContentRef = LocalFileContentRef;
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
  readonly creationKind: AssetCreationKind;
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

export function isPortableWorkspaceRelativePath(
  value: unknown,
): value is string {
  if (
    !isRequiredText(value) ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return false;
  }

  const segments = value.split('/');

  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..',
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

export function isAssetCreationKind(
  value: unknown,
): value is AssetCreationKind {
  return value === 'imported' || value === 'generated';
}

export function isAssetContentRef(value: unknown): value is AssetContentRef {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind !== LOCAL_FILE_CONTENT_KIND) {
    return false;
  }

  return (
    (value.base === PROJECT_WORKSPACE_CONTENT_BASE &&
      isPortableWorkspaceRelativePath(value.path)) ||
    (value.base === ABSOLUTE_CONTENT_BASE &&
      isAbsoluteFileSystemPath(value.path))
  );
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
    isAssetCreationKind(value.creationKind) &&
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

export function createProjectWorkspaceContentRef(
  path: string,
): ProjectWorkspaceLocalFileContentRef {
  const contentRef = {
    kind: LOCAL_FILE_CONTENT_KIND,
    base: PROJECT_WORKSPACE_CONTENT_BASE,
    path: path.trim(),
  } as const;

  if (!isAssetContentRef(contentRef)) {
    throw new Error('Project Workspace ContentRef 数据无效');
  }

  return Object.freeze(contentRef);
}

export function createAbsoluteLocalFileContentRef(
  path: string,
): AbsoluteLocalFileContentRef {
  const contentRef = {
    kind: LOCAL_FILE_CONTENT_KIND,
    base: ABSOLUTE_CONTENT_BASE,
    path: path.trim(),
  } as const;

  if (!isAssetContentRef(contentRef)) {
    throw new Error('Absolute LocalFileContentRef 数据无效');
  }

  return Object.freeze(contentRef);
}

export function cloneAssetContentRef(
  contentRef: AssetContentRef,
): AssetContentRef {
  if (contentRef.base === PROJECT_WORKSPACE_CONTENT_BASE) {
    return createProjectWorkspaceContentRef(contentRef.path);
  }

  return createAbsoluteLocalFileContentRef(contentRef.path);
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

export function createAssetContentStatus(
  availability: AssetAvailability,
  checkedTime: number,
): AssetContentStatus {
  return cloneAssetContentStatus({ availability, checkedTime });
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
    creationKind: asset.creationKind,
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
