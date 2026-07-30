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
  ExternalLibraryInstallationStore,
  createExternalLibraryInstallationMarker,
} from './external-library-installation-store';

const temporaryDirectories: string[] = [];

function createDefinition() {
  const packageDefinition = {
    platform: 'darwin' as const,
    architecture: 'arm64' as const,
    packageType: 'dmg' as const,
    downloadUrl: 'https://download.example/libreoffice.dmg',
    sha256: 'a'.repeat(64),
    executableRelativePath:
      'LibreOffice.app/Contents/MacOS/soffice',
  };
  return {
    definition: {
      id: 'libreoffice',
      displayName: 'LibreOffice',
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
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ExternalLibraryInstallationStore', () => {
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
    const store = new ExternalLibraryInstallationStore();
    const marker = createExternalLibraryInstallationMarker({
      definition,
      packageDefinition,
      installedTime: 1,
    });

    await store.write(installationDirectory, marker);

    await expect(
      store.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'available',
      marker,
      executablePath,
    });
  });

  it('distinguishes missing, invalid and mismatched installations', async () => {
    const installationDirectory =
      await createInstallationDirectory();
    const { definition, packageDefinition } = createDefinition();
    const store = new ExternalLibraryInstallationStore();

    await expect(
      store.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({ status: 'not-installed' });

    await writeFile(
      join(installationDirectory, 'installation.json'),
      '{broken',
    );
    await expect(
      store.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'marker-invalid',
    });

    await store.write(
      installationDirectory,
      createExternalLibraryInstallationMarker({
        definition: { ...definition, version: 'different' },
        packageDefinition,
        installedTime: 1,
      }),
    );
    await expect(
      store.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'definition-mismatch',
    });
  });

  it('reports a matching marker without an executable as invalid', async () => {
    const installationDirectory =
      await createInstallationDirectory();
    const { definition, packageDefinition } = createDefinition();
    const store = new ExternalLibraryInstallationStore();
    await store.write(
      installationDirectory,
      createExternalLibraryInstallationMarker({
        definition,
        packageDefinition,
        installedTime: 1,
      }),
    );

    await expect(
      store.inspect(
        installationDirectory,
        definition,
        packageDefinition,
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'runtime-missing',
    });
  });

  it('refuses to persist an invalid installation marker', async () => {
    const installationDirectory =
      await createInstallationDirectory();
    const store = new ExternalLibraryInstallationStore();

    await expect(
      store.write(installationDirectory, {
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
