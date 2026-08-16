import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExternalLibraryInstallerRegistry,
  validateInstalledExecutable,
} from './external-library-installer';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRuntimeExecutable(mode: number): Promise<{
  readonly installationDirectory: string;
  readonly executablePath: string;
}> {
  const installationDirectory = await mkdtemp(
    join(tmpdir(), 'learning-companion-installer-'),
  );
  temporaryDirectories.push(installationDirectory);
  const executablePath = join(
    installationDirectory,
    'runtime',
    'bin',
    'tool',
  );
  await mkdir(join(installationDirectory, 'runtime', 'bin'), {
    recursive: true,
  });
  await writeFile(executablePath, 'fixture');
  await chmod(executablePath, mode);
  return { installationDirectory, executablePath };
}

describe('ExternalLibraryInstallerRegistry', () => {
  it('registers one Installer for each package type', () => {
    const registry = new ExternalLibraryInstallerRegistry();
    const dmg = {
      packageType: 'dmg' as const,
      install: vi.fn(),
    };
    const msi = {
      packageType: 'msi' as const,
      install: vi.fn(),
    };

    registry.register(dmg);
    registry.register(msi);

    expect(registry.require('dmg')).toBe(dmg);
    expect(registry.require('msi')).toBe(msi);
  });

  it('rejects duplicates and missing Installers', () => {
    const registry = new ExternalLibraryInstallerRegistry();
    const dmg = {
      packageType: 'dmg' as const,
      install: vi.fn(),
    };
    registry.register(dmg);

    expect(() => registry.register(dmg)).toThrow(
      'REGISTRATION_CONFLICT',
    );
    expect(() => registry.require('msi')).toThrow(
      'FEATURE_NOT_SUPPORTED',
    );
  });
});

describe.runIf(process.platform !== 'win32')(
  'validateInstalledExecutable target-platform permissions',
  () => {
    it('accepts a Windows executable without a Unix executable bit', async () => {
      const { installationDirectory, executablePath } =
        await createRuntimeExecutable(0o600);

      await expect(
        validateInstalledExecutable(
          installationDirectory,
          'bin/tool',
          'win32',
        ),
      ).resolves.toBe(executablePath);
    });

    it('requires a Unix executable bit for a macOS executable', async () => {
      const { installationDirectory } =
        await createRuntimeExecutable(0o600);

      await expect(
        validateInstalledExecutable(
          installationDirectory,
          'bin/tool',
          'darwin',
        ),
      ).rejects.toMatchObject({
        code: 'EXTERNAL_LIBRARY_INSTALL_FAILED',
      });
    });
  },
);
