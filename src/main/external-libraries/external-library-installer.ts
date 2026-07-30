import { constants } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { AppError } from '../errors/app-error';
import type {
  ExternalLibraryPackageDefinition,
  ExternalLibraryPackageType,
} from './external-library-definition';

export interface ExternalLibraryInstallRequest {
  readonly packagePath: string;
  readonly stagingInstallationDirectory: string;
  readonly packageDefinition: ExternalLibraryPackageDefinition;
}

export interface ExternalLibraryInstaller {
  readonly packageType: ExternalLibraryPackageType;
  install(
    request: ExternalLibraryInstallRequest,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface ExternalLibraryInstallerRegistryApi {
  register(installer: ExternalLibraryInstaller): void;
  require(packageType: ExternalLibraryPackageType): ExternalLibraryInstaller;
}

export function requireInstallerAbsolutePath(value: string): string {
  const path = value.trim();

  if (!isAbsolute(path)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return path;
}

export async function validateInstalledExecutable(
  request: ExternalLibraryInstallRequest,
): Promise<string> {
  const executablePath = join(
    requireInstallerAbsolutePath(
      request.stagingInstallationDirectory,
    ),
    'runtime',
    ...request.packageDefinition.executableRelativePath.split('/'),
  );

  try {
    const stats = await lstat(executablePath);

    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
    }

    await access(executablePath, constants.X_OK);
    return executablePath;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
      cause: error,
    });
  }
}

export class ExternalLibraryInstallerRegistry
  implements ExternalLibraryInstallerRegistryApi
{
  private readonly installers =
    new Map<ExternalLibraryPackageType, ExternalLibraryInstaller>();

  register(installer: ExternalLibraryInstaller): void {
    if (
      (installer.packageType !== 'dmg' &&
        installer.packageType !== 'msi') ||
      typeof installer.install !== 'function'
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    if (this.installers.has(installer.packageType)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.installers.set(installer.packageType, installer);
  }

  require(
    packageType: ExternalLibraryPackageType,
  ): ExternalLibraryInstaller {
    const installer = this.installers.get(packageType);

    if (!installer) {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }

    return installer;
  }
}
