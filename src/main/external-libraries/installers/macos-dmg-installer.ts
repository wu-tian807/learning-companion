import { cp, lstat, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { AppError } from '../../errors/app-error';
import type {
  ExternalCommandRunnerApi,
} from '../external-command-runner';
import { ExternalCommandRunner } from '../external-command-runner';
import type {
  ExternalLibraryDmgPackageDefinition,
} from '../external-library-definition';
import {
  requireInstallerAbsolutePath,
  type ExternalLibraryInstallRequest,
  type ExternalLibraryInstaller,
  validateInstalledExecutable,
} from '../external-library-installer';

const HDIUTIL_PATH = '/usr/bin/hdiutil';
const CODESIGN_PATH = '/usr/bin/codesign';
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const CLEANUP_TIMEOUT_MS = 60 * 1000;

export interface MacosDmgInstallerDependencies {
  readonly commandRunner: ExternalCommandRunnerApi;
  readonly logger: Pick<Console, 'warn'>;
}

export class MacosDmgInstaller implements ExternalLibraryInstaller {
  readonly packageType = 'dmg' as const;
  private readonly commandRunner: ExternalCommandRunnerApi;
  private readonly logger: Pick<Console, 'warn'>;

  constructor(
    dependencies: Partial<MacosDmgInstallerDependencies> = {},
  ) {
    this.commandRunner =
      dependencies.commandRunner ?? new ExternalCommandRunner();
    this.logger = dependencies.logger ?? console;
  }

  async install(
    request: ExternalLibraryInstallRequest,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      request.packageDefinition.packageType !== 'dmg' ||
      !('packagePath' in request)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const packageDefinition: ExternalLibraryDmgPackageDefinition =
      request.packageDefinition;
    const packagePath = requireInstallerAbsolutePath(request.packagePath);
    const stagingInstallationDirectory =
      requireInstallerAbsolutePath(
        request.stagingInstallationDirectory,
      );
    const mountPoint = join(
      stagingInstallationDirectory,
      '.dmg-mount',
    );
    const runtimeDirectory = join(
      stagingInstallationDirectory,
      'runtime',
    );
    let mounted = false;

    await mkdir(mountPoint, { recursive: true });
    await mkdir(runtimeDirectory, { recursive: true });

    try {
      await this.commandRunner.run({
        command: HDIUTIL_PATH,
        args: [
          'attach',
          '-readonly',
          '-nobrowse',
          '-mountpoint',
          mountPoint,
          packagePath,
        ],
        timeoutMs: INSTALL_TIMEOUT_MS,
        signal,
      });
      mounted = true;

      const payloadPath = join(
        mountPoint,
        ...packageDefinition.payloadRelativePath.split('/'),
      );
      const payloadStats = await lstat(payloadPath);

      if (!payloadStats.isDirectory() || payloadStats.isSymbolicLink()) {
        throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
      }

      const destinationPath = join(
        runtimeDirectory,
        ...packageDefinition.payloadRelativePath.split('/'),
      );
      await mkdir(dirname(destinationPath), { recursive: true });
      await cp(payloadPath, destinationPath, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
        dereference: false,
        verbatimSymlinks: true,
      });
      await validateInstalledExecutable(
        stagingInstallationDirectory,
        packageDefinition.executableRelativePath,
        packageDefinition.platform,
      );

      if (packageDefinition.verifyCodeSignature) {
        await this.commandRunner.run({
          command: CODESIGN_PATH,
          args: ['--verify', '--deep', '--strict', destinationPath],
          timeoutMs: INSTALL_TIMEOUT_MS,
          signal,
        });
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
    } finally {
      if (mounted) {
        await this.commandRunner
          .run({
            command: HDIUTIL_PATH,
            args: ['detach', mountPoint, '-force'],
            timeoutMs: CLEANUP_TIMEOUT_MS,
          })
          .catch((error: unknown) => {
            this.logger.warn('卸载外部运行时 DMG 失败', error);
          });
      }

      await rm(mountPoint, { recursive: true, force: true }).catch(
        (error: unknown) => {
          this.logger.warn('清理外部运行时 DMG 挂载目录失败', error);
        },
      );
    }
  }
}
