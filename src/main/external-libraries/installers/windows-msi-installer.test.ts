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

import { AppError } from '../../errors/app-error';
import type {
  ExternalCommandRequest,
  ExternalCommandRunnerApi,
} from '../external-command-runner';
import {
  WindowsMsiInstaller,
} from './windows-msi-installer';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('WindowsMsiInstaller', () => {
  it('preserves MSI property quoting for a staging path with spaces', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-msi-installer-'),
    );
    temporaryDirectories.push(directory);
    const packagePath = join(directory, 'libreoffice.msi');
    const stagingInstallationDirectory = join(
      directory,
      'installation with spaces',
    );
    await writeFile(packagePath, 'fake msi');
    const run = vi.fn(
      async (request: ExternalCommandRequest) => {
        const targetArgument = request.args.find((argument) =>
          argument.startsWith('TARGETDIR='),
        )!;
        const runtimeDirectory = targetArgument
          .slice('TARGETDIR='.length)
          .replace(/^"|"$/gu, '');
        const executablePath = join(
          runtimeDirectory,
          'program',
          'soffice.exe',
        );
        await mkdir(dirname(executablePath), { recursive: true });
        await writeFile(executablePath, 'fake exe');
        await chmod(executablePath, 0o755);
        return { stdout: '', stderr: '' };
      },
    );
    const commandRunner: ExternalCommandRunnerApi = { run };
    const installer = new WindowsMsiInstaller({
      commandRunner,
      resolveMsiexecPath: () => '/Windows/System32/msiexec.exe',
    });
    const request = {
      packagePath,
      stagingInstallationDirectory,
      packageDefinition: {
        platform: 'win32' as const,
        architecture: 'x64' as const,
        packageType: 'msi' as const,
        downloadUrl: 'https://download.example/libreoffice.msi',
        sha256: 'b'.repeat(64),
        expectedSize: 8,
        executableRelativePath: 'program/soffice.exe',
      },
    };

    await installer.install(request, new AbortController().signal);

    await expect(
      access(
        join(
          stagingInstallationDirectory,
          'runtime',
          'program',
          'soffice.exe',
        ),
      ),
    ).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledWith({
      command: '/Windows/System32/msiexec.exe',
      args: [
        '/a',
        `"${packagePath}"`,
        '/qn',
        '/L*V',
        `"${join(directory, 'msiexec.log')}"`,
        `TARGETDIR="${join(stagingInstallationDirectory, 'runtime')}"`,
      ],
      windowsVerbatimArguments: true,
      timeoutMs: 20 * 60 * 1000,
      signal: expect.any(AbortSignal),
    });
  });

  it('refuses to pass a partial download to Windows Installer', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-msi-installer-'),
    );
    temporaryDirectories.push(directory);
    const run = vi.fn<ExternalCommandRunnerApi['run']>();
    const installer = new WindowsMsiInstaller({
      commandRunner: { run },
      resolveMsiexecPath: () => '/Windows/System32/msiexec.exe',
    });

    await expect(
      installer.install(
        {
          packagePath: join(directory, 'libreoffice.msi.partial'),
          stagingInstallationDirectory: join(directory, 'installation'),
          packageDefinition: {
            platform: 'win32',
            architecture: 'x64',
            packageType: 'msi',
            downloadUrl: 'https://download.example/libreoffice.msi',
            sha256: 'b'.repeat(64),
            expectedSize: 8,
            executableRelativePath: 'program/soffice.exe',
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expect.any(AppError));
    expect(run).not.toHaveBeenCalled();
  });
});
