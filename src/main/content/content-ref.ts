import type { ContentHandle } from './content-handle';

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

export type AssetContentAvailability =
  | 'available'
  | 'missing'
  | 'inaccessible'
  | 'invalid';

export interface AssetContentStatus {
  readonly availability: AssetContentAvailability;
  readonly checkedTime: Date;
}

export interface ResolvedAssetContent {
  readonly ref: AssetContentRef;
  readonly status: AssetContentStatus;
  readonly handle?: ContentHandle;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`AssetContentRef ${field} 不能为空`);
  }

  return normalized;
}

export function createLocalFileContentRef(path: string): LocalFileContentRef {
  return Object.freeze({
    kind: LOCAL_FILE_CONTENT_KIND,
    path: requireText(path, 'path'),
  });
}

export function createManagedJsonContentRef(
  contentId: string,
): ManagedJsonContentRef {
  return Object.freeze({
    kind: MANAGED_JSON_CONTENT_KIND,
    contentId: requireText(contentId, 'contentId'),
  });
}

export function cloneAssetContentRef(
  ref: AssetContentRef,
): AssetContentRef {
  switch (ref.kind) {
    case LOCAL_FILE_CONTENT_KIND:
      return createLocalFileContentRef(ref.path);
    case MANAGED_JSON_CONTENT_KIND:
      return createManagedJsonContentRef(ref.contentId);
  }
}

export function createAssetContentStatus(
  availability: AssetContentAvailability,
  checkedTime: Date,
): AssetContentStatus {
  if (!(checkedTime instanceof Date) || Number.isNaN(checkedTime.getTime())) {
    throw new Error('AssetContentStatus checkedTime 必须是有效日期');
  }

  return Object.freeze({
    availability,
    checkedTime: new Date(checkedTime.getTime()),
  });
}
