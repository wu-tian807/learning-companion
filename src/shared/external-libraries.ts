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

export interface ExternalLibraryVariantSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly expectedSize: number;
  readonly estimatedInstalledSize?: number;
  readonly recommendedFreeSpace?: number;
}

export interface ExternalLibrarySnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: 'document' | 'media';
  readonly version: string;
  readonly expectedSize?: number;
  readonly estimatedInstalledSize?: number;
  readonly recommendedFreeSpace?: number;
  readonly variants?: readonly ExternalLibraryVariantSnapshot[];
  readonly defaultVariantId?: string;
  readonly installedVariantId?: string;
  readonly operationVariantId?: string;
  readonly rootPath: string;
  readonly status: ExternalLibraryStatus;
  readonly installationPath?: string;
  readonly progress?: ExternalLibraryProgress;
  readonly statusDetail?: string;
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
    !isRequiredText(value.description) ||
    (value.category !== 'document' && value.category !== 'media') ||
    !isRequiredText(value.version) ||
    !isAbsoluteFileSystemPath(value.rootPath) ||
    !isExternalLibraryStatus(value.status)
  ) {
    return false;
  }

  if (value.variants === undefined) {
    if (
      value.defaultVariantId !== undefined ||
      value.installedVariantId !== undefined ||
      value.operationVariantId !== undefined
    ) {
      return false;
    }
  } else {
    if (
      !Array.isArray(value.variants) ||
      value.variants.length < 1 ||
      !value.variants.every(
        (variant) =>
          isRecord(variant) &&
          isRequiredText(variant.id) &&
          isRequiredText(variant.displayName) &&
          typeof variant.expectedSize === 'number' &&
          Number.isSafeInteger(variant.expectedSize) &&
          variant.expectedSize > 0 &&
          ((variant.estimatedInstalledSize === undefined &&
            variant.recommendedFreeSpace === undefined) ||
            (typeof variant.estimatedInstalledSize === 'number' &&
              Number.isSafeInteger(variant.estimatedInstalledSize) &&
              variant.estimatedInstalledSize > 0 &&
              typeof variant.recommendedFreeSpace === 'number' &&
              Number.isSafeInteger(variant.recommendedFreeSpace) &&
              variant.recommendedFreeSpace >= variant.estimatedInstalledSize)),
      ) ||
      !isRequiredText(value.defaultVariantId)
    ) {
      return false;
    }

    const variantIds = new Set(
      (value.variants as readonly ExternalLibraryVariantSnapshot[]).map(
        ({ id }) => id,
      ),
    );
    if (
      variantIds.size !== value.variants.length ||
      !variantIds.has(value.defaultVariantId) ||
      (value.installedVariantId !== undefined &&
        (!isRequiredText(value.installedVariantId) ||
          !variantIds.has(value.installedVariantId))) ||
      (value.operationVariantId !== undefined &&
        (!isRequiredText(value.operationVariantId) ||
          !variantIds.has(value.operationVariantId)))
    ) {
      return false;
    }
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
    (value.estimatedInstalledSize === undefined) !==
      (value.recommendedFreeSpace === undefined) ||
    (value.estimatedInstalledSize !== undefined &&
      (typeof value.estimatedInstalledSize !== 'number' ||
        !Number.isSafeInteger(value.estimatedInstalledSize) ||
        value.estimatedInstalledSize <= 0 ||
        typeof value.recommendedFreeSpace !== 'number' ||
        !Number.isSafeInteger(value.recommendedFreeSpace) ||
        value.recommendedFreeSpace < value.estimatedInstalledSize))
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

  if (
    value.statusDetail !== undefined &&
    !isRequiredText(value.statusDetail)
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
    description: value.description.trim(),
    category: value.category,
    version: value.version.trim(),
    ...(value.expectedSize === undefined
      ? {}
      : { expectedSize: value.expectedSize }),
    ...(value.estimatedInstalledSize === undefined
      ? {}
      : {
          estimatedInstalledSize: value.estimatedInstalledSize,
          recommendedFreeSpace: value.recommendedFreeSpace,
        }),
    ...(value.variants === undefined
      ? {}
      : {
          variants: Object.freeze(
            value.variants.map((variant) =>
              Object.freeze({
                id: variant.id.trim(),
                displayName: variant.displayName.trim(),
                expectedSize: variant.expectedSize,
                ...(variant.estimatedInstalledSize === undefined
                  ? {}
                  : {
                      estimatedInstalledSize: variant.estimatedInstalledSize,
                      recommendedFreeSpace: variant.recommendedFreeSpace,
                    }),
              }),
            ),
          ),
          defaultVariantId: value.defaultVariantId!.trim(),
          ...(value.installedVariantId === undefined
            ? {}
            : {
                installedVariantId:
                  value.installedVariantId.trim(),
              }),
          ...(value.operationVariantId === undefined
            ? {}
            : {
                operationVariantId:
                  value.operationVariantId.trim(),
              }),
        }),
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
    ...(value.statusDetail === undefined
      ? {}
      : { statusDetail: value.statusDetail.trim() }),
    ...(value.errorCode === undefined
      ? {}
      : { errorCode: value.errorCode.trim() }),
  });
}
