import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { AppError } from '../../errors/app-error';
import type {
  ExternalCommandRunnerApi,
} from '../external-command-runner';
import { ExternalCommandRunner } from '../external-command-runner';
import {
  requireInstallerAbsolutePath,
  type ExternalLibraryInstallRequest,
  type ExternalLibraryInstaller,
  validateInstalledExecutable,
} from '../external-library-installer';

const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;

export interface WindowsMsiInstallerDependencies {
  readonly commandRunner: ExternalCommandRunnerApi;
  readonly resolveMsiexecPath: () => string;
}

function defaultResolveMsiexecPath(): string {
  const systemRoot = process.env.SystemRoot?.trim();

  if (!systemRoot || !isAbsolute(systemRoot)) {
    throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
  }

  return join(systemRoot, 'System32', 'msiexec.exe');
}

export class WindowsMsiInstaller implements ExternalLibraryInstaller {
  readonly packageType = 'msi' as const;
  private readonly commandRunner: ExternalCommandRunnerApi;
  private readonly resolveMsiexecPath: () => string;

  constructor(
    dependencies: Partial<WindowsMsiInstallerDependencies> = {},
  ) {
    this.commandRunner =
      dependencies.commandRunner ?? new ExternalCommandRunner();
    this.resolveMsiexecPath =
      dependencies.resolveMsiexecPath ?? defaultResolveMsiexecPath;
  }

  async install(
    request: ExternalLibraryInstallRequest,
    signal: AbortSignal,
  ): Promise<void> {
    if (request.packageDefinition.packageType !== 'msi') {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const packagePath = requireInstallerAbsolutePath(request.packagePath);
    const stagingInstallationDirectory =
      requireInstallerAbsolutePath(
        request.stagingInstallationDirectory,
      );
    const runtimeDirectory = join(
      stagingInstallationDirectory,
      'runtime',
    );
    await mkdir(runtimeDirectory, { recursive: true });

    await this.commandRunner.run({
      command: requireInstallerAbsolutePath(
        this.resolveMsiexecPath(),
      ),
      args: [
        '/a',
        packagePath,
        '/qn',
        '/norestart',
        `TARGETDIR=${runtimeDirectory}`,
      ],
      timeoutMs: INSTALL_TIMEOUT_MS,
      signal,
    });
    await validateInstalledExecutable(request);
  }
}
