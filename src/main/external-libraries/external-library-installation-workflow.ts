import { join } from 'node:path';

import type { ExternalLibraryProgress } from '../../shared/external-libraries';
import { AppError } from '../errors/app-error';
import {
  externalLibraryAbortReason,
  shouldDiscardExternalLibraryDownloads,
} from './external-library-abort';
import {
  externalLibraryPackageExpectedSize,
  externalLibraryPackageResources,
  type ExternalLibraryDefinition,
  type ExternalLibraryPackageDefinition,
} from './external-library-definition';
import type { ExternalLibraryDownloaderApi } from './external-library-downloader';
import {
  createExternalLibraryInstallationMarker,
  type ExternalLibraryInstallationInspection,
  type ExternalLibraryInstallationManifestFile,
} from './external-library-installation-manifest-file';
import type {
  ExternalLibraryDownloadedBundleResource,
  ExternalLibraryInstallRequest,
  ExternalLibraryInstallerRegistryApi,
} from './external-library-installer';
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
  readonly installationManifestFile: ExternalLibraryInstallationManifestFile;
  readonly downloader: ExternalLibraryDownloaderApi;
  readonly installers: ExternalLibraryInstallerRegistryApi;
  readonly now: () => number;
  readonly logger: Pick<Console, 'warn'>;
}

export interface ExternalLibraryInstallationWorkflowInput {
  readonly rootPath: string;
  readonly definition: ExternalLibraryDefinition;
  readonly packageDefinition: ExternalLibraryPackageDefinition;
  readonly replaceExisting?: boolean;
  readonly signal: AbortSignal;
  readonly onStage: (stage: ExternalLibraryInstallationStage) => void;
}

interface DownloadedResource {
  readonly id: string;
  readonly path: string;
}

function createInstallRequest(
  packageDefinition: ExternalLibraryPackageDefinition,
  stagingInstallationDirectory: string,
  downloaded: readonly DownloadedResource[],
): ExternalLibraryInstallRequest {
  if (packageDefinition.packageType !== 'bundle') {
    if (downloaded.length !== 1) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return {
      packagePath: downloaded[0]!.path,
      stagingInstallationDirectory,
      packageDefinition,
    };
  }

  const resources: ExternalLibraryDownloadedBundleResource[] =
    packageDefinition.resources.map((definition) => {
      const match = downloaded.find(({ id }) => id === definition.id);
      if (!match) throw new AppError('DATA_INTEGRITY_ERROR');

      return Object.freeze({
        definition,
        path: match.path,
      });
    });

  return {
    packageDefinition,
    resources: Object.freeze(resources),
    stagingInstallationDirectory,
  };
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
      replaceExisting,
      rootPath,
      signal,
      onStage,
    } = input;
    const stagingDirectory =
      await this.dependencies.pathManager.createStagingDirectory(
        rootPath,
        definition.id,
      );
    let installationAvailable = false;

    try {
      const resources = externalLibraryPackageResources(packageDefinition);
      const totalBytes = externalLibraryPackageExpectedSize(
        packageDefinition,
      );
      const downloaded: DownloadedResource[] = [];
      let completedBeforeCurrent = 0;

      onStage({
        status: 'downloading',
        progress: { completedBytes: 0, totalBytes },
      });

      for (const resourceDefinition of resources) {
        if (signal.aborted) throw externalLibraryAbortReason(signal);

        const downloadPaths =
          await this.dependencies.pathManager.prepareDownloadPaths({
            rootPath,
            definition,
            packageDefinition,
            resourceDefinition,
          });
        const result = await this.dependencies.downloader.download({
          resourceDefinition,
          destinationPath: downloadPaths.destinationPath,
          signal,
          onProgress: (progress) => {
            onStage({
              status: 'downloading',
              progress: {
                completedBytes:
                  completedBeforeCurrent + progress.completedBytes,
                totalBytes,
              },
            });
          },
        });

        if (result.packagePath !== downloadPaths.destinationPath) {
          throw new AppError('DATA_INTEGRITY_ERROR');
        }

        const path = await this.dependencies.pathManager.completeDownload(
          downloadPaths,
        );
        downloaded.push({ id: resourceDefinition.id, path });
        completedBeforeCurrent += result.byteLength;
      }

      onStage({ status: 'verifying' });
      if (completedBeforeCurrent !== totalBytes) {
        throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
      }

      onStage({ status: 'installing' });
      const stagingInstallationDirectory = join(
        stagingDirectory,
        'installation',
      );
      const installer = this.dependencies.installers.require(
        packageDefinition.packageType,
      );
      await installer.install(
        createInstallRequest(
          packageDefinition,
          stagingInstallationDirectory,
          downloaded,
        ),
        signal,
      );

      if (signal.aborted) throw externalLibraryAbortReason(signal);

      await this.dependencies.installationManifestFile.write(
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
          replaceExisting,
        });
      const inspection =
        await this.dependencies.installationManifestFile.inspect(
          paths.installationDirectory,
          definition,
          packageDefinition,
        );

      if (inspection.status !== 'available') {
        throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
      }

      installationAvailable = true;
      return inspection;
    } finally {
      if (
        installationAvailable ||
        shouldDiscardExternalLibraryDownloads(signal)
      ) {
        await this.dependencies.pathManager
          .cleanupPackageDownloads(
            rootPath,
            definition,
            packageDefinition,
          )
          .catch((error: unknown) => {
            this.dependencies.logger.warn(
              '清理外部运行时下载缓存失败',
              error,
            );
          });
      }
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
