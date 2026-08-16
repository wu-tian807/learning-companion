import { createHash } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

import extractZip from 'extract-zip';

import { AppError } from '../../errors/app-error';
import { isPathInside } from '../../filesystem/file-system-path-rules';
import type {
  ExternalLibraryBundlePackageDefinition,
  ExternalLibraryBundleResourceDefinition,
} from '../external-library-definition';
import {
  requireInstallerAbsolutePath,
  type ExternalLibraryBundleInstallRequest,
  type ExternalLibraryDownloadedBundleResource,
  type ExternalLibraryInstallRequest,
  type ExternalLibraryInstaller,
  validateInstalledExecutable,
  validateInstalledRuntimeFile,
} from '../external-library-installer';

function createAbortError(): DOMException {
  return new DOMException(
    'External library bundle installation cancelled',
    'AbortError',
  );
}

function requireBundleRequest(
  request: ExternalLibraryInstallRequest,
): ExternalLibraryBundleInstallRequest {
  if (
    request.packageDefinition.packageType !== 'bundle' ||
    !('resources' in request)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return request;
}

function requireResource(
  request: ExternalLibraryBundleInstallRequest,
  definition: ExternalLibraryBundleResourceDefinition,
): ExternalLibraryDownloadedBundleResource {
  const matches = request.resources.filter(
    (resource) => resource.definition.id === definition.id,
  );

  if (
    matches.length !== 1 ||
    matches[0]!.definition.sha256 !== definition.sha256
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return matches[0]!;
}

function resolveRuntimeDestination(
  runtimeDirectory: string,
  relativePath: string,
): string {
  const destination = resolve(
    runtimeDirectory,
    ...relativePath.split('/'),
  );

  if (
    destination === runtimeDirectory ||
    !isPathInside(runtimeDirectory, destination)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return destination;
}

async function validateNoLinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stats = await lstat(path);

    if (stats.isSymbolicLink()) {
      throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
    }
    if (stats.isDirectory()) {
      await validateNoLinks(path);
      continue;
    }
    if (!stats.isFile()) {
      throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
    }
  }
}

async function sha256File(path: string): Promise<{
  readonly sha256: string;
  readonly size: number;
}> {
  const hash = createHash('sha256');
  let size = 0;

  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    hash.update(buffer);
  }

  return { sha256: hash.digest('hex'), size };
}

async function installResource(
  runtimeDirectory: string,
  resource: ExternalLibraryDownloadedBundleResource,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw createAbortError();

  const sourcePath = requireInstallerAbsolutePath(resource.path);
  const installation = resource.definition.installation;
  const destination = resolveRuntimeDestination(
    runtimeDirectory,
    installation.destinationRelativePath,
  );

  if (installation.type === 'zip') {
    await mkdir(destination, { recursive: true });
    await extractZip(sourcePath, { dir: destination });
    if (signal.aborted) throw createAbortError();
    await validateNoLinks(destination);
    return;
  }

  await mkdir(dirname(destination), { recursive: true });

  if (installation.type === 'file') {
    await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
    return;
  }

  await pipeline(
    createReadStream(sourcePath),
    createGunzip(),
    createWriteStream(destination, { flags: 'wx' }),
    { signal },
  );
  const output = await sha256File(destination);

  if (
    output.size !== installation.outputSize ||
    output.sha256 !== installation.outputSha256
  ) {
    throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
  }
}

export class ExternalLibraryBundleInstaller
  implements ExternalLibraryInstaller
{
  readonly packageType = 'bundle' as const;

  async install(
    rawRequest: ExternalLibraryInstallRequest,
    signal: AbortSignal,
  ): Promise<void> {
    const request = requireBundleRequest(rawRequest);
    const packageDefinition: ExternalLibraryBundlePackageDefinition =
      request.packageDefinition;

    if (request.resources.length !== packageDefinition.resources.length) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const installationDirectory = requireInstallerAbsolutePath(
      request.stagingInstallationDirectory,
    );
    const runtimeDirectory = join(installationDirectory, 'runtime');
    await mkdir(runtimeDirectory, { recursive: true });

    try {
      for (const definition of packageDefinition.resources) {
        await installResource(
          runtimeDirectory,
          requireResource(request, definition),
          signal,
        );
      }

      await validateNoLinks(runtimeDirectory);
      for (const relativePath of packageDefinition.requiredRelativePaths) {
        if (relativePath === packageDefinition.executableRelativePath) {
          await validateInstalledExecutable(
            installationDirectory,
            relativePath,
            packageDefinition.platform,
          );
        } else {
          await validateInstalledRuntimeFile(
            installationDirectory,
            relativePath,
          );
        }
      }
    } catch (error) {
      if (
        error instanceof AppError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error;
      }

      throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
        cause: error,
      });
    }
  }
}
