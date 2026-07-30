import { join } from 'node:path';

import type { ExternalLibraryProgress } from '../../shared/external-libraries';
import { AppError } from '../errors/app-error';
import type {
  ExternalLibraryDefinition,
  ExternalLibraryPackageDefinition,
} from './external-library-definition';
import type { ExternalLibraryDownloaderApi } from './external-library-downloader';
import {
  createExternalLibraryInstallationMarker,
  type ExternalLibraryInstallationInspection,
  type ExternalLibraryInstallationStore,
} from './external-library-installation-store';
import type { ExternalLibraryInstallerRegistryApi } from './external-library-installer';
import type { ExternalLibraryPathManagerApi } from './external-library-path-manager';

export type ExternalLibraryInstallationStage =
  | {
      readonly status: 'downloading';
      readonly progress: ExternalLibraryProgress;
    }
  | {
      readonly status: 'verifying' | 'installing';
    };

export interface ExternalLibraryInstallationWorkflowDependencies {
  readonly pathManager: ExternalLibraryPathManagerApi;
  readonly installationStore: ExternalLibraryInstallationStore;
  readonly downloader: ExternalLibraryDownloaderApi;
  readonly installers: ExternalLibraryInstallerRegistryApi;
  readonly now: () => number;
  readonly logger: Pick<Console, 'warn'>;
}

export interface ExternalLibraryInstallationWorkflowInput {
  readonly rootPath: string;
  readonly definition: ExternalLibraryDefinition;
  readonly packageDefinition: ExternalLibraryPackageDefinition;
  readonly signal: AbortSignal;
  readonly onStage: (stage: ExternalLibraryInstallationStage) => void;
}

function createAbortError(): DOMException {
  return new DOMException(
    'External library installation cancelled',
    'AbortError',
  );
}

export class ExternalLibraryInstallationWorkflow {
  constructor(
    private readonly dependencies:
      ExternalLibraryInstallationWorkflowDependencies,
  ) {}

  async run(
    input: ExternalLibraryInstallationWorkflowInput,
  ): Promise<ExternalLibraryInstallationInspection> {
    const {
      definition,
      packageDefinition,
      rootPath,
      signal,
      onStage,
    } = input;
    const stagingDirectory =
      await this.dependencies.pathManager.createStagingDirectory(
        rootPath,
        definition.id,
      );

    try {
      onStage({
        status: 'downloading',
        progress: {
          completedBytes: 0,
          totalBytes: packageDefinition.expectedSize,
        },
      });
      const packagePath = join(
        stagingDirectory,
        `package.${packageDefinition.packageType}.partial`,
      );
      const downloaded = await this.dependencies.downloader.download({
        packageDefinition,
        destinationPath: packagePath,
        signal,
        onProgress: (progress) => {
          onStage({ status: 'downloading', progress });
        },
        onVerifying: () => {
          onStage({ status: 'verifying' });
        },
      });
      onStage({ status: 'installing' });
      const stagingInstallationDirectory = join(
        stagingDirectory,
        'installation',
      );
      const installer = this.dependencies.installers.require(
        packageDefinition.packageType,
      );
      await installer.install(
        {
          packagePath: downloaded.packagePath,
          stagingInstallationDirectory,
          packageDefinition,
        },
        signal,
      );

      if (signal.aborted) {
        throw createAbortError();
      }

      await this.dependencies.installationStore.write(
        stagingInstallationDirectory,
        createExternalLibraryInstallationMarker({
          definition,
          packageDefinition,
          installedTime: this.dependencies.now(),
        }),
      );
      const paths =
        await this.dependencies.pathManager.commitInstallation({
          rootPath,
          definition,
          packageDefinition,
          stagingDirectory,
          stagingInstallationDirectory,
        });
      const inspection =
        await this.dependencies.installationStore.inspect(
          paths.installationDirectory,
          definition,
          packageDefinition,
        );

      if (inspection.status !== 'available') {
        throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
      }

      return inspection;
    } finally {
      await this.dependencies.pathManager
        .cleanupStagingDirectory(rootPath, stagingDirectory)
        .catch((error: unknown) => {
          this.dependencies.logger.warn(
            '清理外部运行时 staging 失败',
            error,
          );
        });
    }
  }
}
