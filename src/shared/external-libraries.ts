import { isAbsoluteFileSystemPath } from './projects';

export type ExternalLibraryStatus =
  | 'not-installed'
  | 'discovering'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'available'
  | 'invalid'
  | 'migrating'
  | 'failed'
  | 'unsupported';

export interface ExternalLibraryProgress {
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface ExternalLibrarySnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly expectedSize?: number;
  readonly rootPath: string;
  readonly status: ExternalLibraryStatus;
  readonly installationPath?: string;
  readonly progress?: ExternalLibraryProgress;
  readonly errorCode?: string;
}

export type ExternalLibraryMigrationConflictResolution =
  | 'keep-target'
  | 'replace-target';

export interface ExternalLibraryMigrationConflict {
  readonly libraryId: string;
  readonly displayName: string;
  readonly targetPath: string;
  readonly targetStatus: 'available' | 'invalid';
}

export interface ExternalLibraryMigrationResult {
  readonly status: 'conflict' | 'completed';
  readonly rootPath: string;
  readonly conflicts: readonly ExternalLibraryMigrationConflict[];
  readonly libraries: readonly ExternalLibrarySnapshot[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isExternalLibraryStatus(
  value: unknown,
): value is ExternalLibraryStatus {
  return (
    value === 'not-installed' ||
    value === 'discovering' ||
    value === 'downloading' ||
    value === 'verifying' ||
    value === 'installing' ||
    value === 'available' ||
    value === 'invalid' ||
    value === 'migrating' ||
    value === 'failed' ||
    value === 'unsupported'
  );
}

export function isExternalLibrarySnapshot(
  value: unknown,
): value is ExternalLibrarySnapshot {
  if (
    !isRecord(value) ||
    !isRequiredText(value.id) ||
    !isRequiredText(value.displayName) ||
    !isRequiredText(value.version) ||
    !isAbsoluteFileSystemPath(value.rootPath) ||
    !isExternalLibraryStatus(value.status)
  ) {
    return false;
  }

  if (
    value.status === 'unsupported'
      ? value.expectedSize !== undefined
      : typeof value.expectedSize !== 'number' ||
        !Number.isSafeInteger(value.expectedSize) ||
        value.expectedSize <= 0
  ) {
    return false;
  }

  if (
    value.installationPath !== undefined &&
    !isAbsoluteFileSystemPath(value.installationPath)
  ) {
    return false;
  }

  if (
    value.errorCode !== undefined &&
    !isRequiredText(value.errorCode)
  ) {
    return false;
  }

  return (
    value.progress === undefined ||
    (isRecord(value.progress) &&
      typeof value.progress.completedBytes === 'number' &&
      Number.isSafeInteger(value.progress.completedBytes) &&
      value.progress.completedBytes >= 0 &&
      typeof value.progress.totalBytes === 'number' &&
      Number.isSafeInteger(value.progress.totalBytes) &&
      value.progress.totalBytes > 0 &&
      value.progress.completedBytes <= value.progress.totalBytes)
  );
}

export function cloneExternalLibrarySnapshot(
  value: ExternalLibrarySnapshot,
): ExternalLibrarySnapshot {
  if (!isExternalLibrarySnapshot(value)) {
    throw new Error('ExternalLibrarySnapshot 数据无效');
  }

  return Object.freeze({
    id: value.id.trim(),
    displayName: value.displayName.trim(),
    version: value.version.trim(),
    ...(value.expectedSize === undefined
      ? {}
      : { expectedSize: value.expectedSize }),
    rootPath: value.rootPath.trim(),
    status: value.status,
    ...(value.installationPath === undefined
      ? {}
      : { installationPath: value.installationPath.trim() }),
    ...(value.progress === undefined
      ? {}
      : {
          progress: Object.freeze({
            completedBytes: value.progress.completedBytes,
            totalBytes: value.progress.totalBytes,
          }),
        }),
    ...(value.errorCode === undefined
      ? {}
      : { errorCode: value.errorCode.trim() }),
  });
}
