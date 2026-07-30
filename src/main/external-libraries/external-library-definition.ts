import {
  isPortableWorkspaceRelativePath,
} from '../../shared/assets';

export type ExternalLibraryPlatform = 'darwin' | 'win32';
export type ExternalLibraryArchitecture = 'arm64' | 'x64';
export type ExternalLibraryPackageType = 'dmg' | 'msi';

interface ExternalLibraryPackageDefinitionBase {
  readonly platform: ExternalLibraryPlatform;
  readonly architecture: ExternalLibraryArchitecture;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly executableRelativePath: string;
}

export interface ExternalLibraryDmgPackageDefinition
  extends ExternalLibraryPackageDefinitionBase {
  readonly platform: 'darwin';
  readonly packageType: 'dmg';
  readonly payloadRelativePath: string;
}

export interface ExternalLibraryMsiPackageDefinition
  extends ExternalLibraryPackageDefinitionBase {
  readonly platform: 'win32';
  readonly packageType: 'msi';
}

export type ExternalLibraryPackageDefinition =
  | ExternalLibraryDmgPackageDefinition
  | ExternalLibraryMsiPackageDefinition;

export interface ExternalLibraryDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly installationFormatVersion: number;
  readonly sourceUrl: string;
  readonly licenseName: string;
  readonly licenseUrl: string;
  readonly packages: readonly ExternalLibraryPackageDefinition[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isRequiredText(value)) {
    return false;
  }

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

export function isExternalLibraryPackageDefinition(
  value: unknown,
): value is ExternalLibraryPackageDefinition {
  if (
    !isRecord(value) ||
    !isExternalLibraryPlatform(value.platform) ||
    !isExternalLibraryArchitecture(value.architecture) ||
    (value.packageType !== 'dmg' && value.packageType !== 'msi') ||
    (value.platform === 'darwin' && value.packageType !== 'dmg') ||
    (value.platform === 'win32' && value.packageType !== 'msi') ||
    !isHttpsUrl(value.downloadUrl) ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    !isPortableWorkspaceRelativePath(value.executableRelativePath) ||
    typeof value.expectedSize !== 'number' ||
    !Number.isSafeInteger(value.expectedSize) ||
    value.expectedSize <= 0 ||
    (value.packageType === 'dmg' &&
      !isPortableWorkspaceRelativePath(value.payloadRelativePath))
  ) {
    return false;
  }

  return true;
}

export function isExternalLibraryDefinition(
  value: unknown,
): value is ExternalLibraryDefinition {
  if (
    !isRecord(value) ||
    !isSafeDirectorySegment(value.id) ||
    !isRequiredText(value.displayName) ||
    !isSafeDirectorySegment(value.version) ||
    typeof value.installationFormatVersion !== 'number' ||
    !Number.isSafeInteger(value.installationFormatVersion) ||
    value.installationFormatVersion <= 0 ||
    !isHttpsUrl(value.sourceUrl) ||
    !isRequiredText(value.licenseName) ||
    !isHttpsUrl(value.licenseUrl) ||
    !Array.isArray(value.packages) ||
    value.packages.length === 0 ||
    !value.packages.every(isExternalLibraryPackageDefinition)
  ) {
    return false;
  }

  const packageKeys = new Set(
    value.packages.map(
      ({ platform, architecture }) => `${platform}/${architecture}`,
    ),
  );
  return packageKeys.size === value.packages.length;
}

function clonePackage(
  value: ExternalLibraryPackageDefinition,
): ExternalLibraryPackageDefinition {
  const base = {
    platform: value.platform,
    architecture: value.architecture,
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
      })
    : Object.freeze({
        ...base,
        packageType: 'msi',
        platform: 'win32',
      });
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
    version: value.version.trim(),
    installationFormatVersion: value.installationFormatVersion,
    sourceUrl: value.sourceUrl.trim(),
    licenseName: value.licenseName.trim(),
    licenseUrl: value.licenseUrl.trim(),
    packages: Object.freeze(value.packages.map(clonePackage)),
  });
}
