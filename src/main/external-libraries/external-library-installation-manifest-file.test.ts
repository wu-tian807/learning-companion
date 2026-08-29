import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  EXTERNAL_LIBRARY_RUNTIME_DIRECTORY,
  ExternalLibraryInstallationManifestFile,
  createExternalLibraryInstallationMarker,
} from './external-library-installation-manifest-file';
import { ExternalLibraryRuntimeSetupRegistry } from './external-library-runtime-setup';

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

async function createInstallationDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-runtime-store-'),
  );
  temporaryDirectories.push(directory);
  return join(directory, 'installation');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ExternalLibraryInstallationManifestFile', () => {
  it('writes and validates an available installation', async () => {
    const installationDirectory =
      await createInstallationDirectory();
    const { definition, packageDefinition } = createDefinition();
    const executablePath = join(
      installationDirectory,
      EXTERNAL_LIBRARY_RUNTIME_DIRECTORY,
      ...packageDefinition.executableRelativePath.split('/'),
    );
    await mkdir(dirname(executablePath), { recursive: true });
    await writeFile(executablePath, '#!/bin/sh\nexit 0\n');
    await chmod(executablePath, 0o755);
    const manifestFile = new ExternalLibraryInstallationManifestFile();
    await mkdir(installationDirectory, { recursive: true });
    const marker = createExternalLibraryInstallationMarker({
      definition,
      packageDefinition,
      installedTime: 1,
    });

    await manifestFile.write(installationDirectory, marker);

    await expect(
      manifestFile.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'available',
      marker,
      runtimeDirectory: join(
        installationDirectory,
        EXTERNAL_LIBRARY_RUNTIME_DIRECTORY,
      ),
      executablePath,
    });
  });

  it('distinguishes missing, invalid and mismatched installations', async () => {
    const installationDirectory =
      await createInstallationDirectory();
    const { definition, packageDefinition } = createDefinition();
    const manifestFile = new ExternalLibraryInstallationManifestFile();

    await expect(
      manifestFile.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({ status: 'not-installed' });

    await mkdir(installationDirectory);
    await expect(
      manifestFile.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'marker-invalid',
    });

    await writeFile(
      join(installationDirectory, 'installation.json'),
      '{broken',
    );
    await expect(
      manifestFile.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'marker-invalid',
    });

    await manifestFile.write(
      installationDirectory,
      createExternalLibraryInstallationMarker({
        definition: { ...definition, version: 'different' },
        packageDefinition,
        installedTime: 1,
      }),
    );
    await expect(
      manifestFile.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'definition-mismatch',
    });
  });

  it('accepts a models-only bundle without inventing an executable', async () => {
    const installationDirectory =
      await createInstallationDirectory();
    const definition = {
      id: 'subtitle-translation-fast',
      displayName: 'Subtitle translation',
      description: 'Local translation models',
      category: 'media' as const,
      version: '1.0.0',
      installationFormatVersion: 1,
      sourceUrl: 'https://example.com/source',
      licenseName: 'MPL-2.0',
      licenseUrl: 'https://example.com/license',
      packages: [
        {
          platform: 'win32' as const,
          architecture: 'x64' as const,
          packageType: 'bundle' as const,
          resources: [
            {
              id: 'model',
              downloadUrl: 'https://example.com/model.bin',
              sha256: 'b'.repeat(64),
              expectedSize: 10,
              installation: {
                type: 'file' as const,
                destinationRelativePath: 'models/model.bin',
              },
            },
          ],
          requiredRelativePaths: ['models/model.bin'],
        },
      ],
    };
    const packageDefinition = definition.packages[0];
    const modelPath = join(
      installationDirectory,
      EXTERNAL_LIBRARY_RUNTIME_DIRECTORY,
      'models',
      'model.bin',
    );
    await mkdir(dirname(modelPath), { recursive: true });
    await writeFile(modelPath, 'model');
    const manifestFile = new ExternalLibraryInstallationManifestFile();
    const marker = createExternalLibraryInstallationMarker({
      definition,
      packageDefinition,
      installedTime: 1,
    });
    await manifestFile.write(installationDirectory, marker);

    await expect(
      manifestFile.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'available',
      marker,
      runtimeDirectory: join(
        installationDirectory,
        EXTERNAL_LIBRARY_RUNTIME_DIRECTORY,
      ),
    });
  });

  it('reports a matching marker without an executable as invalid', async () => {
    const installationDirectory =
      await createInstallationDirectory();
    const { definition, packageDefinition } = createDefinition();
    const manifestFile = new ExternalLibraryInstallationManifestFile();
    await manifestFile.write(
      installationDirectory,
      createExternalLibraryInstallationMarker({
        definition,
        packageDefinition,
        installedTime: 1,
      }),
    );

    await expect(
      manifestFile.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'runtime-missing',
    });
  });

  it('does not report available until the registered runtime setup is ready', async () => {
    const installationDirectory =
      await createInstallationDirectory();
    const { definition, packageDefinition } = createDefinition();
    const executablePath = join(
      installationDirectory,
      EXTERNAL_LIBRARY_RUNTIME_DIRECTORY,
      ...packageDefinition.executableRelativePath.split('/'),
    );
    await mkdir(dirname(executablePath), { recursive: true });
    await writeFile(executablePath, '#!/bin/sh\nexit 0\n');
    await chmod(executablePath, 0o755);
    let ready = false;
    const runtimeSetups = new ExternalLibraryRuntimeSetupRegistry();
    runtimeSetups.register({
      libraryId: definition.id,
      prepare: async () => undefined,
      isReady: async () => ready,
    });
    const manifestFile = new ExternalLibraryInstallationManifestFile(
      runtimeSetups,
    );
    await manifestFile.write(
      installationDirectory,
      createExternalLibraryInstallationMarker({
        definition,
        packageDefinition,
        installedTime: 1,
      }),
    );

    await expect(
      manifestFile.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'runtime-missing',
    });

    ready = true;
    await expect(
      manifestFile.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toMatchObject({ status: 'available' });
  });

  it('refuses to persist an invalid installation marker', async () => {
    const installationDirectory =
      await createInstallationDirectory();
    const manifestFile = new ExternalLibraryInstallationManifestFile();

    await expect(
      manifestFile.write(installationDirectory, {
        schemaVersion: 1,
        libraryId: '',
        libraryVersion: '1',
        installationFormatVersion: 1,
        platform: 'darwin',
        architecture: 'arm64',
        packageSha256: 'a'.repeat(64),
        installedTime: 1,
      }),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });
});
