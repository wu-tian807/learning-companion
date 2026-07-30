import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { DEFAULT_APP_PREFERENCES } from '../../shared/app-preferences';
import type { SettingsRepository } from '../settings/settings-repository';
import { ExternalLibraryDownloader } from './external-library-downloader';
import { ExternalLibraryInstallationStore } from './external-library-installation-store';
import {
  ExternalLibraryInstallerRegistry,
  type ExternalLibraryInstaller,
} from './external-library-installer';
import { ExternalLibraryPathManager } from './external-library-path-manager';
import { ExternalLibraryRegistry } from './external-library-registry';
import {
  ExternalLibraryService,
} from './external-library-service';

const temporaryDirectories: string[] = [];

interface Harness {
  readonly rootPath: string;
  readonly registry: ExternalLibraryRegistry;
  readonly pathManager: ExternalLibraryPathManager;
  readonly installationStore: ExternalLibraryInstallationStore;
  readonly installer: ExternalLibraryInstaller;
  readonly service: ExternalLibraryService;
}

function createDefinition(content: Uint8Array) {
  return {
    id: 'libreoffice',
    displayName: 'LibreOffice',
    version: '25.2.5.2',
    installationFormatVersion: 1,
    sourceUrl: 'https://www.libreoffice.org/',
    licenseName: 'MPL-2.0',
    licenseUrl: 'https://www.libreoffice.org/about-us/licenses',
    packages: [
      {
        platform: 'darwin' as const,
        architecture: 'arm64' as const,
        packageType: 'dmg' as const,
        downloadUrl: 'https://download.example/libreoffice.dmg',
        sha256: createHash('sha256').update(content).digest('hex'),
        expectedSize: content.byteLength,
        executableRelativePath:
          'LibreOffice.app/Contents/MacOS/soffice',
        payloadRelativePath: 'LibreOffice.app',
        verifyCodeSignature: true,
      },
    ],
  };
}

function createSettings(rootPath: string): SettingsRepository {
  return {
    initialize: vi.fn(async () => undefined),
    get: vi.fn(() => DEFAULT_APP_PREFERENCES),
    updateHomePreferences: vi.fn(async () => DEFAULT_APP_PREFERENCES),
    getDefaultProjectWorkspace: vi.fn(() => dirname(rootPath)),
    updateDefaultProjectWorkspace: vi.fn(async () => undefined),
    getExternalLibrariesPath: vi.fn(() => rootPath),
    updateExternalLibrariesPath: vi.fn(async () => undefined),
  };
}

async function createHarness(input?: {
  readonly downloader?: ConstructorParameters<
    typeof ExternalLibraryService
  >[4];
}): Promise<Harness> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-runtime-service-'),
  );
  temporaryDirectories.push(directory);
  const rootPath = join(directory, 'externalLib');
  const content = new TextEncoder().encode('trusted package');
  const registry = new ExternalLibraryRegistry();
  registry.register(createDefinition(content));
  const pathManager = new ExternalLibraryPathManager({
    createId: () => 'job',
  });
  const installationStore = new ExternalLibraryInstallationStore();
  const install = vi.fn<ExternalLibraryInstaller['install']>(
    async (request) => {
      const executablePath = join(
        request.stagingInstallationDirectory,
        'runtime',
        ...request.packageDefinition.executableRelativePath.split('/'),
      );
      await mkdir(dirname(executablePath), { recursive: true });
      await writeFile(executablePath, '#!/bin/sh\nexit 0\n');
      await chmod(executablePath, 0o755);
    },
  );
  const installer: ExternalLibraryInstaller = {
    packageType: 'dmg',
    install,
  };
  const installers = new ExternalLibraryInstallerRegistry();
  installers.register(installer);
  const downloader =
    input?.downloader ??
    new ExternalLibraryDownloader({
      fetch: vi.fn(async () =>
        new Response(content, {
          status: 200,
          headers: {
            'content-length': String(content.byteLength),
          },
        }),
      ),
    });
  const service = new ExternalLibraryService(
    createSettings(rootPath),
    registry,
    pathManager,
    installationStore,
    downloader,
    installers,
    {
      platform: 'darwin',
      architecture: 'arm64',
      now: () => 10,
      logger: { warn: vi.fn() },
    },
  );

  return {
    rootPath,
    registry,
    pathManager,
    installationStore,
    installer,
    service,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ExternalLibraryService', () => {
  it('discovers, installs and exposes a verified executable', async () => {
    const harness = await createHarness();
    const statuses: string[] = [];
    harness.service.subscribe((snapshot) => {
      statuses.push(snapshot.status);
    });

    await harness.service.initialize();
    expect(harness.service.list()).toMatchObject([
      { id: 'libreoffice', status: 'not-installed' },
    ]);

    const installed = await harness.service.install('libreoffice');
    const executablePath =
      await harness.service.requireExecutable('libreoffice');

    expect(installed).toMatchObject({
      id: 'libreoffice',
      status: 'available',
    });
    expect(statuses).toEqual(
      expect.arrayContaining([
        'discovering',
        'not-installed',
        'downloading',
        'verifying',
        'installing',
        'available',
      ]),
    );
    await expect(access(executablePath)).resolves.toBeUndefined();
    expect(harness.installer.install).toHaveBeenCalledOnce();
  });

  it('reuses an installed runtime across Service instances', async () => {
    const first = await createHarness();
    await first.service.initialize();
    await first.service.install('libreoffice');

    const definition = first.registry.require('libreoffice');
    const packageDefinition = first.registry.selectPackage(
      'libreoffice',
      'darwin',
      'arm64',
    );
    const secondInstaller = {
      packageType: 'dmg' as const,
      install: vi.fn(),
    };
    const secondInstallers = new ExternalLibraryInstallerRegistry();
    secondInstallers.register(secondInstaller);
    const secondService = new ExternalLibraryService(
      createSettings(first.rootPath),
      first.registry,
      first.pathManager,
      first.installationStore,
      {
        download: vi.fn(),
      },
      secondInstallers,
      {
        platform: 'darwin',
        architecture: 'arm64',
      },
    );

    await secondService.initialize();

    expect(secondService.list()).toMatchObject([
      { status: 'available' },
    ]);
    expect(
      await secondService.requireExecutable(definition.id),
    ).toBe(join(
      first.pathManager.resolveInstallationPaths(
        first.rootPath,
        definition,
        packageDefinition,
      ).runtimeDirectory,
      ...packageDefinition.executableRelativePath.split('/'),
    ));
    expect(secondInstaller.install).not.toHaveBeenCalled();
  });

  it('refuses to overwrite an unrecognized target installation', async () => {
    const harness = await createHarness();
    const definition = harness.registry.require('libreoffice');
    const packageDefinition = harness.registry.selectPackage(
      definition.id,
      'darwin',
      'arm64',
    );
    const paths = harness.pathManager.resolveInstallationPaths(
      harness.rootPath,
      definition,
      packageDefinition,
    );
    await mkdir(paths.installationDirectory, { recursive: true });
    await writeFile(join(paths.installationDirectory, 'unknown.txt'), 'keep');

    await harness.service.initialize();

    expect(harness.service.list()).toMatchObject([
      { status: 'invalid', errorCode: 'marker-invalid' },
    ]);
    await expect(
      harness.service.install('libreoffice'),
    ).rejects.toThrow('EXTERNAL_LIBRARY_CONFLICT');
    await expect(
      access(join(paths.installationDirectory, 'unknown.txt')),
    ).resolves.toBeUndefined();
    expect(harness.installer.install).not.toHaveBeenCalled();
  });

  it('deduplicates installation and supports cancellation', async () => {
    const download = vi.fn(
      async (input: Parameters<
        ConstructorParameters<typeof ExternalLibraryService>[4]['download']
      >[0]) =>
        new Promise<never>((_resolvePromise, rejectPromise) => {
          input.signal.addEventListener(
            'abort',
            () =>
              rejectPromise(
                new DOMException('cancelled', 'AbortError'),
              ),
            { once: true },
          );
        }),
    );
    const harness = await createHarness({ downloader: { download } });
    await harness.service.initialize();

    const first = harness.service.install('libreoffice');
    const second = harness.service.install('libreoffice');
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    harness.service.cancel('libreoffice');

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() =>
      expect(harness.service.list()).toMatchObject([
        { status: 'not-installed' },
      ]),
    );
  });

  it('removes only the selected versioned installation', async () => {
    const harness = await createHarness();
    await harness.service.initialize();
    const installed = await harness.service.install('libreoffice');

    const removed = await harness.service.remove('libreoffice');

    expect(removed.status).toBe('not-installed');
    await expect(access(installed.installationPath!)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
