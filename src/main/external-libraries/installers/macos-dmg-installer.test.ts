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

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ExternalCommandRequest,
  ExternalCommandRunnerApi,
} from '../external-command-runner';
import {
  MacosDmgInstaller,
} from './macos-dmg-installer';

const temporaryDirectories: string[] = [];

async function createInput() {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-dmg-installer-'),
  );
  temporaryDirectories.push(directory);
  const packagePath = join(directory, 'libreoffice.dmg');
  const stagingInstallationDirectory = join(directory, 'installation');
  await writeFile(packagePath, 'fake dmg');

  return {
    packagePath,
    stagingInstallationDirectory,
    packageDefinition: {
      platform: 'darwin' as const,
      architecture: 'arm64' as const,
      packageType: 'dmg' as const,
      downloadUrl: 'https://download.example/libreoffice.dmg',
      sha256: 'a'.repeat(64),
      expectedSize: 8,
      executableRelativePath:
        'LibreOffice.app/Contents/MacOS/soffice',
      payloadRelativePath: 'LibreOffice.app',
      verifyCodeSignature: true,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('MacosDmgInstaller', () => {
  it('mounts read-only, copies the payload and verifies its signature', async () => {
    const input = await createInput();
    const run = vi.fn(
      async (request: ExternalCommandRequest) => {
        if (
          request.command === '/usr/bin/hdiutil' &&
          request.args[0] === 'attach'
        ) {
          const mountPoint =
            request.args[request.args.indexOf('-mountpoint') + 1]!;
          const executablePath = join(
            mountPoint,
            'LibreOffice.app',
            'Contents',
            'MacOS',
            'soffice',
          );
          await mkdir(dirname(executablePath), { recursive: true });
          await writeFile(executablePath, '#!/bin/sh\nexit 0\n');
          await chmod(executablePath, 0o755);
        }

        return { stdout: '', stderr: '' };
      },
    );
    const commandRunner: ExternalCommandRunnerApi = { run };
    const installer = new MacosDmgInstaller({ commandRunner });

    await installer.install(input, new AbortController().signal);

    const installedExecutable = join(
      input.stagingInstallationDirectory,
      'runtime',
      ...input.packageDefinition.executableRelativePath.split('/'),
    );
    await expect(access(installedExecutable)).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/usr/bin/hdiutil',
        args: expect.arrayContaining(['attach', '-readonly', '-nobrowse']),
      }),
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/usr/bin/codesign',
        args: expect.arrayContaining(['--verify', '--deep', '--strict']),
      }),
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/usr/bin/hdiutil',
        args: expect.arrayContaining(['detach', '-force']),
      }),
    );
  });

  it('always removes the private mount directory after a mounted failure', async () => {
    const input = await createInput();
    const run = vi.fn(
      async (request: ExternalCommandRequest) => {
        if (request.args[0] === 'attach') {
          const mountPoint =
            request.args[request.args.indexOf('-mountpoint') + 1]!;
          await mkdir(join(mountPoint, 'LibreOffice.app'));
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
    );
    const installer = new MacosDmgInstaller({
      commandRunner: { run },
      logger: { warn: vi.fn() },
    });

    await expect(
      installer.install(input, new AbortController().signal),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INSTALL_FAILED');
    await expect(
      access(join(input.stagingInstallationDirectory, '.dmg-mount')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/usr/bin/hdiutil',
        args: expect.arrayContaining(['detach']),
      }),
    );
  });
});
