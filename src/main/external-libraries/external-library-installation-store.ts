import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { isUnixMilliseconds } from '../../shared/projects';
import { AppError } from '../errors/app-error';
import {
  isExternalLibraryDefinition,
  isExternalLibraryPackageDefinition,
  type ExternalLibraryArchitecture,
  type ExternalLibraryDefinition,
  type ExternalLibraryPackageDefinition,
  type ExternalLibraryPlatform,
} from './external-library-definition';

export const EXTERNAL_LIBRARY_INSTALLATION_MARKER =
  'installation.json';
export const EXTERNAL_LIBRARY_RUNTIME_DIRECTORY = 'runtime';
export const EXTERNAL_LIBRARY_INSTALLATION_SCHEMA_VERSION = 1 as const;

export interface ExternalLibraryInstallationMarker {
  readonly schemaVersion:
    typeof EXTERNAL_LIBRARY_INSTALLATION_SCHEMA_VERSION;
  readonly libraryId: string;
  readonly libraryVersion: string;
  readonly installationFormatVersion: number;
  readonly platform: ExternalLibraryPlatform;
  readonly architecture: ExternalLibraryArchitecture;
  readonly packageSha256: string;
  readonly installedTime: number;
}

export type ExternalLibraryInstallationInspection =
  | {
      readonly status: 'not-installed';
    }
  | {
      readonly status: 'invalid';
      readonly reason:
        | 'marker-invalid'
        | 'definition-mismatch'
        | 'runtime-missing';
    }
  | {
      readonly status: 'available';
      readonly marker: ExternalLibraryInstallationMarker;
      readonly executablePath: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as NodeJS.ErrnoException).code === 'ENOTDIR')
  );
}

export function createExternalLibraryInstallationMarker(input: {
  readonly definition: ExternalLibraryDefinition;
  readonly packageDefinition: ExternalLibraryPackageDefinition;
  readonly installedTime: number;
}): ExternalLibraryInstallationMarker {
  if (
    !isExternalLibraryDefinition(input.definition) ||
    !isExternalLibraryPackageDefinition(input.packageDefinition) ||
    !input.definition.packages.some(
      (candidate) =>
        candidate.platform === input.packageDefinition.platform &&
        candidate.architecture ===
          input.packageDefinition.architecture &&
        candidate.sha256 === input.packageDefinition.sha256,
    ) ||
    !isUnixMilliseconds(input.installedTime)
  ) {
    throw new Error('ExternalLibrary 安装标记输入无效');
  }

  return Object.freeze({
    schemaVersion: EXTERNAL_LIBRARY_INSTALLATION_SCHEMA_VERSION,
    libraryId: input.definition.id,
    libraryVersion: input.definition.version,
    installationFormatVersion:
      input.definition.installationFormatVersion,
    platform: input.packageDefinition.platform,
    architecture: input.packageDefinition.architecture,
    packageSha256: input.packageDefinition.sha256,
    installedTime: input.installedTime,
  });
}

function parseMarker(
  value: unknown,
): ExternalLibraryInstallationMarker | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !==
      EXTERNAL_LIBRARY_INSTALLATION_SCHEMA_VERSION ||
    typeof value.libraryId !== 'string' ||
    value.libraryId.trim().length === 0 ||
    typeof value.libraryVersion !== 'string' ||
    value.libraryVersion.trim().length === 0 ||
    typeof value.installationFormatVersion !== 'number' ||
    !Number.isSafeInteger(value.installationFormatVersion) ||
    value.installationFormatVersion <= 0 ||
    (value.platform !== 'darwin' && value.platform !== 'win32') ||
    (value.architecture !== 'arm64' && value.architecture !== 'x64') ||
    typeof value.packageSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.packageSha256) ||
    !isUnixMilliseconds(value.installedTime)
  ) {
    return undefined;
  }

  return Object.freeze({
    schemaVersion: EXTERNAL_LIBRARY_INSTALLATION_SCHEMA_VERSION,
    libraryId: value.libraryId.trim(),
    libraryVersion: value.libraryVersion.trim(),
    installationFormatVersion: value.installationFormatVersion,
    platform: value.platform,
    architecture: value.architecture,
    packageSha256: value.packageSha256,
    installedTime: value.installedTime,
  });
}

function markerMatches(
  marker: ExternalLibraryInstallationMarker,
  definition: ExternalLibraryDefinition,
  packageDefinition: ExternalLibraryPackageDefinition,
): boolean {
  return (
    marker.libraryId === definition.id &&
    marker.libraryVersion === definition.version &&
    marker.installationFormatVersion ===
      definition.installationFormatVersion &&
    marker.platform === packageDefinition.platform &&
    marker.architecture === packageDefinition.architecture &&
    marker.packageSha256 === packageDefinition.sha256
  );
}

export class ExternalLibraryInstallationStore {
  async write(
    installationDirectory: string,
    marker: ExternalLibraryInstallationMarker,
  ): Promise<void> {
    const validatedMarker = parseMarker(marker);

    if (!validatedMarker) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const markerPath = join(
      installationDirectory,
      EXTERNAL_LIBRARY_INSTALLATION_MARKER,
    );
    const temporaryPath = `${markerPath}.tmp`;
    await mkdir(installationDirectory, { recursive: true });

    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(validatedMarker, null, 2)}\n`,
        'utf8',
      );
      await rename(temporaryPath, markerPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async inspect(
    installationDirectory: string,
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): Promise<ExternalLibraryInstallationInspection> {
    let value: unknown;

    try {
      value = JSON.parse(
        await readFile(
          join(
            installationDirectory,
            EXTERNAL_LIBRARY_INSTALLATION_MARKER,
          ),
          'utf8',
        ),
      );
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return Object.freeze({ status: 'not-installed' });
      }

      if (error instanceof SyntaxError) {
        return Object.freeze({
          status: 'invalid',
          reason: 'marker-invalid',
        });
      }

      throw error;
    }

    const marker = parseMarker(value);

    if (!marker) {
      return Object.freeze({
        status: 'invalid',
        reason: 'marker-invalid',
      });
    }

    if (!markerMatches(marker, definition, packageDefinition)) {
      return Object.freeze({
        status: 'invalid',
        reason: 'definition-mismatch',
      });
    }

    const executablePath = join(
      installationDirectory,
      EXTERNAL_LIBRARY_RUNTIME_DIRECTORY,
      ...packageDefinition.executableRelativePath.split('/'),
    );

    try {
      const stats = await lstat(executablePath);

      if (!stats.isFile() || stats.isSymbolicLink()) {
        return Object.freeze({
          status: 'invalid',
          reason: 'runtime-missing',
        });
      }

      await access(executablePath, constants.X_OK);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return Object.freeze({
          status: 'invalid',
          reason: 'runtime-missing',
        });
      }

      if (
        error instanceof Error &&
        'code' in error &&
        ((error as NodeJS.ErrnoException).code === 'EACCES' ||
          (error as NodeJS.ErrnoException).code === 'EPERM')
      ) {
        return Object.freeze({
          status: 'invalid',
          reason: 'runtime-missing',
        });
      }

      throw error;
    }

    return Object.freeze({
      status: 'available',
      marker,
      executablePath,
    });
  }
}
