import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, posix, win32 } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ExternalLibraryPathManager,
  EXTERNAL_LIBRARY_DOWNLOAD_RETENTION_MS,
  EXTERNAL_LIBRARY_STAGING_RETENTION_MS,
  createDefaultExternalLibrariesRoot,
} from './external-library-path-manager';

const temporaryDirectories: string[] = [];

function createDefinition() {
  const packageDefinition = {
    platform: 'darwin' as const,
    architecture: 'arm64' as const,
    packageType: 'dmg' as const,
    downloadUrl: 'https://download.example/libreoffice.dmg',
    sha256: 'a'.repeat(64),
    expectedSize: 300_000_000,
    executableRelativePath:
      'LibreOffice.app/Contents/MacOS/soffice',
    payloadRelativePath: 'LibreOffice.app',
    verifyCodeSignature: true,
  };
  return {
    definition: {
      id: 'libreoffice',
      displayName: 'LibreOffice',
      description: 'Office preview',
      category: 'document' as const,
      version: '25.2.5.2',
      installationFormatVersion: 1,
      sourceUrl: 'https://www.libreoffice.org/',
      licenseName: 'MPL-2.0',
      licenseUrl: 'https://www.libreoffice.org/about-us/licenses',
      packages: [packageDefinition],
    },
    packageDefinition,
  };
}

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-runtime-paths-'),
  );
  temporaryDirectories.push(directory);
  return join(directory, 'externalLib');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ExternalLibraryPathManager', () => {
  it('creates the default external library root under Documents', () => {
    expect(
      createDefaultExternalLibrariesRoot(
        '/Users/student/Documents',
        posix,
      ),
    ).toBe(
      '/Users/student/Documents/Learning Companion/externalLib',
    );
    expect(
      createDefaultExternalLibrariesRoot(
        'C:\\Users\\student\\Documents',
        win32,
      ),
    ).toBe(
      'C:\\Users\\student\\Documents\\Learning Companion\\externalLib',
    );
  });

  it('rejects a relative Documents directory', () => {
    expect(() =>
      createDefaultExternalLibrariesRoot('Documents'),
    ).toThrow('DATA_INTEGRITY_ERROR');
  });

  it('commits and removes only the exact versioned installation', async () => {
    const rootPath = await createRoot();
    const manager = new ExternalLibraryPathManager({
      createId: () => 'job',
    });
    const { definition, packageDefinition } = createDefinition();
    const stagingDirectory = await manager.createStagingDirectory(
      rootPath,
      definition.id,
    );
    expect(basename(stagingDirectory).length).toBeLessThanOrEqual(24);
    const stagingInstallationDirectory = join(
      stagingDirectory,
      'installation',
    );
    await mkdir(
      join(stagingInstallationDirectory, 'runtime'),
      { recursive: true },
    );
    await writeFile(
      join(stagingInstallationDirectory, 'installation.json'),
      '{}',
    );

    const paths = await manager.commitInstallation({
      rootPath,
      definition,
      packageDefinition,
      stagingDirectory,
      stagingInstallationDirectory,
    });

    expect(paths.installationDirectory).toBe(
      join(rootPath, 'libreoffice', '25.2.5.2', 'darwin-arm64'),
    );
    await expect(
      access(join(paths.installationDirectory, 'installation.json')),
    ).resolves.toBeUndefined();

    await manager.removeInstallation(
      rootPath,
      definition,
      packageDefinition,
    );

    await expect(access(paths.installationDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not overwrite an existing installation', async () => {
    const rootPath = await createRoot();
    const manager = new ExternalLibraryPathManager();
    const { definition, packageDefinition } = createDefinition();
    const paths = manager.resolveInstallationPaths(
      rootPath,
      definition,
      packageDefinition,
    );
    await mkdir(paths.installationDirectory, { recursive: true });
    await writeFile(join(paths.installationDirectory, 'keep.txt'), 'keep');
    const stagingDirectory = await manager.createStagingDirectory(
      rootPath,
      definition.id,
    );
    const stagingInstallationDirectory = join(
      stagingDirectory,
      'installation',
    );
    await mkdir(stagingInstallationDirectory);

    await expect(
      manager.commitInstallation({
        rootPath,
        definition,
        packageDefinition,
        stagingDirectory,
        stagingInstallationDirectory,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_CONFLICT');
    await expect(
      access(join(paths.installationDirectory, 'keep.txt')),
    ).resolves.toBeUndefined();
  });

  it('refuses broad staging cleanup targets', async () => {
    const rootPath = await createRoot();
    const manager = new ExternalLibraryPathManager();
    const stagingDirectory = await manager.createStagingDirectory(
      rootPath,
      'libreoffice',
    );

    await expect(
      manager.cleanupStagingDirectory(rootPath, rootPath),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    await expect(access(stagingDirectory)).resolves.toBeUndefined();
  });

  it('keeps resumable downloads in stable package-scoped paths', async () => {
    const rootPath = await createRoot();
    const manager = new ExternalLibraryPathManager();
    const { definition, packageDefinition } = createDefinition();
    const resourceDefinition = {
      id: 'package-dmg',
      downloadUrl: packageDefinition.downloadUrl,
      sha256: packageDefinition.sha256,
      expectedSize: packageDefinition.expectedSize,
    };
    const first = await manager.prepareDownloadPaths({
      rootPath,
      definition,
      packageDefinition,
      resourceDefinition,
    });
    await writeFile(first.partialPath, 'partial');
    await expect(manager.completeDownload(first)).resolves.toBe(
      first.packagePath,
    );

    const afterRestart = await new ExternalLibraryPathManager()
      .prepareDownloadPaths({
        rootPath,
        definition,
        packageDefinition,
        resourceDefinition,
      });

    expect(afterRestart.destinationPath).toBe(first.packagePath);
    await expect(readFile(afterRestart.packagePath, 'utf8')).resolves.toBe(
      'partial',
    );
    expect(afterRestart.packagePath).toContain(
      join('.downloads', 'libreoffice'),
    );

    await manager.cleanupPackageDownloads(
      rootPath,
      definition,
      packageDefinition,
    );
    await expect(access(first.downloadDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('removes expired orphan staging and download directories only', async () => {
    const rootPath = await createRoot();
    const manager = new ExternalLibraryPathManager();
    const { definition, packageDefinition } = createDefinition();
    const currentTime = Date.now();
    const oldStaging = await manager.createStagingDirectory(
      rootPath,
      definition.id,
    );
    const freshStaging = await manager.createStagingDirectory(
      rootPath,
      definition.id,
    );
    const oldStagingFile = join(oldStaging, 'orphan.partial');
    await writeFile(oldStagingFile, 'old');
    const oldStagingTime = new Date(
      currentTime - EXTERNAL_LIBRARY_STAGING_RETENTION_MS - 1_000,
    );
    await utimes(oldStagingFile, oldStagingTime, oldStagingTime);
    await utimes(oldStaging, oldStagingTime, oldStagingTime);

    const oldPackage = {
      ...packageDefinition,
      sha256: 'b'.repeat(64),
    };
    const resourceDefinition = {
      id: 'package-dmg',
      downloadUrl: packageDefinition.downloadUrl,
      sha256: packageDefinition.sha256,
      expectedSize: packageDefinition.expectedSize,
    };
    const oldDownload = await manager.prepareDownloadPaths({
      rootPath,
      definition,
      packageDefinition: oldPackage,
      resourceDefinition: {
        ...resourceDefinition,
        sha256: oldPackage.sha256,
      },
    });
    const freshDownload = await manager.prepareDownloadPaths({
      rootPath,
      definition,
      packageDefinition,
      resourceDefinition,
    });
    await writeFile(oldDownload.partialPath, 'old');
    await writeFile(freshDownload.partialPath, 'fresh');
    const oldDownloadTime = new Date(
      currentTime - EXTERNAL_LIBRARY_DOWNLOAD_RETENTION_MS - 1_000,
    );
    await utimes(
      oldDownload.partialPath,
      oldDownloadTime,
      oldDownloadTime,
    );
    await utimes(
      oldDownload.downloadDirectory,
      oldDownloadTime,
      oldDownloadTime,
    );

    await expect(
      manager.cleanupExpiredTemporaryData(rootPath, currentTime),
    ).resolves.toEqual({
      stagingDirectoriesRemoved: 1,
      downloadDirectoriesRemoved: 1,
    });
    await expect(access(oldStaging)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(oldDownload.downloadDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(freshStaging)).resolves.toBeUndefined();
    await expect(access(freshDownload.partialPath)).resolves.toBeUndefined();
  });
});
