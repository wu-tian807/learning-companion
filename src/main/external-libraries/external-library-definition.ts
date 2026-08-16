import { createHash } from 'node:crypto';

import { isPortableWorkspaceRelativePath } from '../../shared/assets';

export type ExternalLibraryPlatform = 'darwin' | 'win32';
export type ExternalLibraryArchitecture = 'arm64' | 'x64';
export type ExternalLibraryCategory = 'document' | 'media';
export type ExternalLibraryPackageType = 'bundle' | 'dmg' | 'msi';

interface ExternalLibraryPackageDefinitionBase {
  readonly platform: ExternalLibraryPlatform;
  readonly architecture: ExternalLibraryArchitecture;
  readonly variantId?: string;
}

interface ExternalLibrarySinglePackageDefinitionBase
  extends ExternalLibraryPackageDefinitionBase {
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly executableRelativePath: string;
}

export interface ExternalLibraryDmgPackageDefinition
  extends ExternalLibrarySinglePackageDefinitionBase {
  readonly platform: 'darwin';
  readonly packageType: 'dmg';
  readonly payloadRelativePath: string;
  readonly verifyCodeSignature: boolean;
}

export interface ExternalLibraryMsiPackageDefinition
  extends ExternalLibrarySinglePackageDefinitionBase {
  readonly platform: 'win32';
  readonly packageType: 'msi';
}

export type ExternalLibraryBundleResourceInstallation =
  | {
      readonly type: 'file';
      readonly destinationRelativePath: string;
    }
  | {
      readonly type: 'zip';
      readonly destinationRelativePath: string;
    }
  | {
      readonly type: 'gzip';
      readonly destinationRelativePath: string;
      readonly outputSha256: string;
      readonly outputSize: number;
    };

export interface ExternalLibraryBundleResourceDefinition {
  readonly id: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly installation: ExternalLibraryBundleResourceInstallation;
}

export interface ExternalLibraryBundlePackageDefinition
  extends ExternalLibraryPackageDefinitionBase {
  readonly packageType: 'bundle';
  readonly resources: readonly ExternalLibraryBundleResourceDefinition[];
  readonly requiredRelativePaths: readonly string[];
  readonly executableRelativePath?: string;
}

export type ExternalLibraryPackageDefinition =
  | ExternalLibraryBundlePackageDefinition
  | ExternalLibraryDmgPackageDefinition
  | ExternalLibraryMsiPackageDefinition;

export interface ExternalLibraryDownloadResourceDefinition {
  readonly id: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
}

export interface ExternalLibraryDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: ExternalLibraryCategory;
  readonly version: string;
  readonly installationFormatVersion: number;
  readonly sourceUrl: string;
  readonly licenseName: string;
  readonly licenseUrl: string;
  readonly variants?: readonly ExternalLibraryVariantDefinition[];
  readonly defaultVariantId?: string;
  readonly packages: readonly ExternalLibraryPackageDefinition[];
}

export interface ExternalLibraryVariantDefinition {
  readonly id: string;
  readonly displayName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isRequiredText(value)) return false;

  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeDirectorySegment(value: unknown): value is string {
  return (
    isRequiredText(value) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.trim()) &&
    value.trim() !== '.' &&
    value.trim() !== '..'
  );
}

function portablePathsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

export function isExternalLibraryPlatform(
  value: unknown,
): value is ExternalLibraryPlatform {
  return value === 'darwin' || value === 'win32';
}

export function isExternalLibraryArchitecture(
  value: unknown,
): value is ExternalLibraryArchitecture {
  return value === 'arm64' || value === 'x64';
}

function isExternalLibraryDownloadResource(
  value: unknown,
): value is ExternalLibraryDownloadResourceDefinition {
  return (
    isRecord(value) &&
    isSafeDirectorySegment(value.id) &&
    isHttpsUrl(value.downloadUrl) &&
    isSha256(value.sha256) &&
    isPositiveSafeInteger(value.expectedSize)
  );
}

function isBundleResource(
  value: unknown,
): value is ExternalLibraryBundleResourceDefinition {
  if (
    !isRecord(value) ||
    !isExternalLibraryDownloadResource(value) ||
    !isRecord(value.installation) ||
    (value.installation.type !== 'file' &&
      value.installation.type !== 'gzip' &&
      value.installation.type !== 'zip') ||
    !isPortableWorkspaceRelativePath(
      value.installation.destinationRelativePath,
    )
  ) {
    return false;
  }

  return (
    value.installation.type !== 'gzip' ||
    (isSha256(value.installation.outputSha256) &&
      isPositiveSafeInteger(value.installation.outputSize))
  );
}

export function isExternalLibraryPackageDefinition(
  value: unknown,
): value is ExternalLibraryPackageDefinition {
  if (
    !isRecord(value) ||
    !isExternalLibraryPlatform(value.platform) ||
    !isExternalLibraryArchitecture(value.architecture) ||
    (value.variantId !== undefined &&
      !isSafeDirectorySegment(value.variantId))
  ) {
    return false;
  }

  if (value.packageType === 'bundle') {
    if (
      !Array.isArray(value.resources) ||
      value.resources.length === 0 ||
      !value.resources.every(isBundleResource) ||
      !Array.isArray(value.requiredRelativePaths) ||
      value.requiredRelativePaths.length === 0 ||
      !value.requiredRelativePaths.every(isPortableWorkspaceRelativePath) ||
      (value.executableRelativePath !== undefined &&
        !isPortableWorkspaceRelativePath(value.executableRelativePath))
    ) {
      return false;
    }

    const resourceIds = new Set(
      value.resources.map((resource) => resource.id),
    );
    const destinations = new Set(
      value.resources.map(
        (resource) => resource.installation.destinationRelativePath,
      ),
    );
    const requiredPaths = new Set(value.requiredRelativePaths);
    const destinationList = [...destinations];
    const hasOverlappingDestinations = destinationList.some(
      (destination, index) =>
        destinationList
          .slice(index + 1)
          .some((candidate) =>
            portablePathsOverlap(destination, candidate),
          ),
    );
    const expectedSize = value.resources.reduce(
      (total, resource) => total + resource.expectedSize,
      0,
    );

    return (
      resourceIds.size === value.resources.length &&
      destinations.size === value.resources.length &&
      !hasOverlappingDestinations &&
      Number.isSafeInteger(expectedSize) &&
      requiredPaths.size === value.requiredRelativePaths.length &&
      (value.executableRelativePath === undefined ||
        requiredPaths.has(value.executableRelativePath))
    );
  }

  return (
    (value.packageType === 'dmg' || value.packageType === 'msi') &&
    (value.platform !== 'darwin' || value.packageType === 'dmg') &&
    (value.platform !== 'win32' || value.packageType === 'msi') &&
    isHttpsUrl(value.downloadUrl) &&
    isSha256(value.sha256) &&
    isPositiveSafeInteger(value.expectedSize) &&
    isPortableWorkspaceRelativePath(value.executableRelativePath) &&
    (value.packageType !== 'dmg' ||
      (isPortableWorkspaceRelativePath(value.payloadRelativePath) &&
        typeof value.verifyCodeSignature === 'boolean'))
  );
}

export function isExternalLibraryDefinition(
  value: unknown,
): value is ExternalLibraryDefinition {
  if (
    !isRecord(value) ||
    !isSafeDirectorySegment(value.id) ||
    !isRequiredText(value.displayName) ||
    !isRequiredText(value.description) ||
    (value.category !== 'document' && value.category !== 'media') ||
    !isSafeDirectorySegment(value.version) ||
    !isPositiveSafeInteger(value.installationFormatVersion) ||
    !isHttpsUrl(value.sourceUrl) ||
    !isRequiredText(value.licenseName) ||
    !isHttpsUrl(value.licenseUrl) ||
    !Array.isArray(value.packages) ||
    value.packages.length === 0 ||
    !value.packages.every(isExternalLibraryPackageDefinition)
  ) {
    return false;
  }

  const packages = value.packages as readonly ExternalLibraryPackageDefinition[];
  const variants = value.variants;
  let variantIds: Set<string> | undefined;

  if (variants === undefined) {
    if (
      value.defaultVariantId !== undefined ||
      packages.some(({ variantId }) => variantId !== undefined)
    ) {
      return false;
    }
  } else {
    if (
      !Array.isArray(variants) ||
      variants.length < 2 ||
      !variants.every(
        (variant) =>
          isRecord(variant) &&
          isSafeDirectorySegment(variant.id) &&
          isRequiredText(variant.displayName),
      ) ||
      !isSafeDirectorySegment(value.defaultVariantId)
    ) {
      return false;
    }

    variantIds = new Set(
      (variants as readonly ExternalLibraryVariantDefinition[]).map(
        ({ id }) => id,
      ),
    );
    if (
      variantIds.size !== variants.length ||
      !variantIds.has(value.defaultVariantId) ||
      packages.some(
        ({ variantId }) =>
          variantId === undefined || !variantIds!.has(variantId),
      )
    ) {
      return false;
    }
  }

  const packageKeys = new Set(
    packages.map(
      ({ platform, architecture, variantId }) =>
        `${platform}/${architecture}/${variantId ?? ''}`,
    ),
  );
  return packageKeys.size === packages.length;
}

function cloneBundleResource(
  value: ExternalLibraryBundleResourceDefinition,
): ExternalLibraryBundleResourceDefinition {
  const installation =
    value.installation.type === 'gzip'
      ? Object.freeze({
          type: 'gzip' as const,
          destinationRelativePath:
            value.installation.destinationRelativePath,
          outputSha256: value.installation.outputSha256,
          outputSize: value.installation.outputSize,
        })
      : Object.freeze({
          type: value.installation.type,
          destinationRelativePath:
            value.installation.destinationRelativePath,
        });

  return Object.freeze({
    id: value.id.trim(),
    downloadUrl: value.downloadUrl.trim(),
    sha256: value.sha256,
    expectedSize: value.expectedSize,
    installation,
  });
}

function clonePackage(
  value: ExternalLibraryPackageDefinition,
): ExternalLibraryPackageDefinition {
  if (value.packageType === 'bundle') {
    return Object.freeze({
      platform: value.platform,
      architecture: value.architecture,
      ...(value.variantId === undefined
        ? {}
        : { variantId: value.variantId }),
      packageType: 'bundle',
      resources: Object.freeze(value.resources.map(cloneBundleResource)),
      requiredRelativePaths: Object.freeze([...value.requiredRelativePaths]),
      ...(value.executableRelativePath === undefined
        ? {}
        : { executableRelativePath: value.executableRelativePath }),
    });
  }

  const base = {
    platform: value.platform,
    architecture: value.architecture,
    ...(value.variantId === undefined
      ? {}
      : { variantId: value.variantId }),
    downloadUrl: value.downloadUrl.trim(),
    sha256: value.sha256,
    expectedSize: value.expectedSize,
    executableRelativePath: value.executableRelativePath,
  } as const;

  return value.packageType === 'dmg'
    ? Object.freeze({
        ...base,
        packageType: 'dmg',
        platform: 'darwin',
        payloadRelativePath: value.payloadRelativePath,
        verifyCodeSignature: value.verifyCodeSignature,
      })
    : Object.freeze({
        ...base,
        packageType: 'msi',
        platform: 'win32',
      });
}

export function externalLibraryPackageResources(
  packageDefinition: ExternalLibraryPackageDefinition,
): readonly ExternalLibraryDownloadResourceDefinition[] {
  if (packageDefinition.packageType === 'bundle') {
    return Object.freeze(
      packageDefinition.resources.map((resource) =>
        Object.freeze({
          id: resource.id,
          downloadUrl: resource.downloadUrl,
          sha256: resource.sha256,
          expectedSize: resource.expectedSize,
        }),
      ),
    );
  }

  return Object.freeze([
    Object.freeze({
      id: `package-${packageDefinition.packageType}`,
      downloadUrl: packageDefinition.downloadUrl,
      sha256: packageDefinition.sha256,
      expectedSize: packageDefinition.expectedSize,
    }),
  ]);
}

export function externalLibraryPackageExpectedSize(
  packageDefinition: ExternalLibraryPackageDefinition,
): number {
  return externalLibraryPackageResources(packageDefinition).reduce(
    (total, resource) => total + resource.expectedSize,
    0,
  );
}

export function externalLibraryPackageFingerprint(
  packageDefinition: ExternalLibraryPackageDefinition,
): string {
  if (
    packageDefinition.packageType !== 'bundle' &&
    packageDefinition.variantId === undefined
  ) {
    return packageDefinition.sha256;
  }

  const canonicalPackage = JSON.stringify(
    packageDefinition.packageType === 'bundle'
      ? {
          ...(packageDefinition.variantId === undefined
            ? {}
            : { variantId: packageDefinition.variantId }),
          resources: packageDefinition.resources.map((resource) => ({
            id: resource.id,
            sha256: resource.sha256,
            installation: resource.installation,
          })),
          requiredRelativePaths:
            packageDefinition.requiredRelativePaths,
          executableRelativePath:
            packageDefinition.executableRelativePath ?? null,
        }
      : {
          variantId: packageDefinition.variantId,
          packageType: packageDefinition.packageType,
          sha256: packageDefinition.sha256,
        },
  );
  return createHash('sha256').update(canonicalPackage).digest('hex');
}

export function externalLibraryRequiredRelativePaths(
  packageDefinition: ExternalLibraryPackageDefinition,
): readonly string[] {
  return packageDefinition.packageType === 'bundle'
    ? Object.freeze([...packageDefinition.requiredRelativePaths])
    : Object.freeze([packageDefinition.executableRelativePath]);
}

export function cloneExternalLibraryDefinition(
  value: ExternalLibraryDefinition,
): ExternalLibraryDefinition {
  if (!isExternalLibraryDefinition(value)) {
    throw new Error('ExternalLibraryDefinition 数据无效');
  }

  return Object.freeze({
    id: value.id.trim(),
    displayName: value.displayName.trim(),
    description: value.description.trim(),
    category: value.category,
    version: value.version.trim(),
    installationFormatVersion: value.installationFormatVersion,
    sourceUrl: value.sourceUrl.trim(),
    licenseName: value.licenseName.trim(),
    licenseUrl: value.licenseUrl.trim(),
    ...(value.variants === undefined
      ? {}
      : {
          variants: Object.freeze(
            value.variants.map((variant) =>
              Object.freeze({
                id: variant.id.trim(),
                displayName: variant.displayName.trim(),
              }),
            ),
          ),
          defaultVariantId: value.defaultVariantId,
        }),
    packages: Object.freeze(value.packages.map(clonePackage)),
  });
}
