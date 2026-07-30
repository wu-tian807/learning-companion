import { join } from 'node:path';

import {
  cloneExternalLibrarySnapshot,
  type ExternalLibrarySnapshot,
  type ExternalLibraryStatus,
} from '../../shared/external-libraries';
import { AppError } from '../errors/app-error';
import type {
  SettingsRepository,
} from '../settings/settings-repository';
import type {
  ExternalLibraryArchitecture,
  ExternalLibraryDefinition,
  ExternalLibraryPackageDefinition,
  ExternalLibraryPlatform,
} from './external-library-definition';
import type {
  ExternalLibraryDownloaderApi,
} from './external-library-downloader';
import {
  createExternalLibraryInstallationMarker,
  type ExternalLibraryInstallationInspection,
  ExternalLibraryInstallationStore,
} from './external-library-installation-store';
import type {
  ExternalLibraryInstallerRegistryApi,
} from './external-library-installer';
import type {
  ExternalLibraryPathManagerApi,
} from './external-library-path-manager';
import type {
  ExternalLibraryRegistryApi,
} from './external-library-registry';

export type ExternalLibraryListener = (
  snapshot: ExternalLibrarySnapshot,
) => void;

export interface ExternalLibraryServiceApi {
  initialize(): Promise<void>;
  list(): readonly ExternalLibrarySnapshot[];
  refresh(libraryId: string): Promise<ExternalLibrarySnapshot>;
  install(libraryId: string): Promise<ExternalLibrarySnapshot>;
  cancel(libraryId: string): void;
  remove(libraryId: string): Promise<ExternalLibrarySnapshot>;
  requireExecutable(libraryId: string): Promise<string>;
  subscribe(listener: ExternalLibraryListener): () => void;
}

export interface ExternalLibraryServiceDependencies {
  readonly platform: ExternalLibraryPlatform;
  readonly architecture: ExternalLibraryArchitecture;
  readonly now: () => number;
  readonly logger: Pick<Console, 'warn'>;
}

interface ActiveInstallation {
  readonly controller: AbortController;
  readonly promise: Promise<ExternalLibrarySnapshot>;
}

function resolveCurrentPlatform(): ExternalLibraryPlatform {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return process.platform;
  }

  throw new AppError('FEATURE_NOT_SUPPORTED');
}

function resolveCurrentArchitecture(): ExternalLibraryArchitecture {
  if (process.arch === 'arm64' || process.arch === 'x64') {
    return process.arch;
  }

  throw new AppError('FEATURE_NOT_SUPPORTED');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'INTERNAL_ERROR';
}

export class ExternalLibraryService
  implements ExternalLibraryServiceApi
{
  private readonly snapshots =
    new Map<string, ExternalLibrarySnapshot>();
  private readonly listeners = new Set<ExternalLibraryListener>();
  private readonly activeInstallations =
    new Map<string, ActiveInstallation>();
  private readonly platform: ExternalLibraryPlatform;
  private readonly architecture: ExternalLibraryArchitecture;
  private readonly now: () => number;
  private readonly logger: Pick<Console, 'warn'>;
  private initializationTask: Promise<void> | undefined;
  private initialized = false;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly registry: ExternalLibraryRegistryApi,
    private readonly pathManager: ExternalLibraryPathManagerApi,
    private readonly installationStore:
      ExternalLibraryInstallationStore,
    private readonly downloader: ExternalLibraryDownloaderApi,
    private readonly installers:
      ExternalLibraryInstallerRegistryApi,
    dependencies: Partial<ExternalLibraryServiceDependencies> = {},
  ) {
    this.platform =
      dependencies.platform ?? resolveCurrentPlatform();
    this.architecture =
      dependencies.architecture ?? resolveCurrentArchitecture();
    this.now = dependencies.now ?? Date.now;
    this.logger = dependencies.logger ?? console;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializationTask) {
      return this.initializationTask;
    }

    const task = this.initializeDefinitions();
    this.initializationTask = task;

    try {
      await task;
      this.initialized = true;
    } finally {
      if (this.initializationTask === task) {
        this.initializationTask = undefined;
      }
    }
  }

  list(): readonly ExternalLibrarySnapshot[] {
    if (!this.initialized) {
      throw new AppError('SERVICE_NOT_READY');
    }

    return this.registry.list().map((definition) => {
      const snapshot = this.snapshots.get(definition.id);

      if (!snapshot) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      return cloneExternalLibrarySnapshot(snapshot);
    });
  }

  async refresh(libraryId: string): Promise<ExternalLibrarySnapshot> {
    await this.initialize();
    const definition = this.registry.require(libraryId);
    const active = this.activeInstallations.get(definition.id);

    if (active) {
      const snapshot = this.snapshots.get(definition.id);

      if (!snapshot) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      return cloneExternalLibrarySnapshot(snapshot);
    }

    return this.refreshDefinition(definition);
  }

  async install(libraryId: string): Promise<ExternalLibrarySnapshot> {
    await this.initialize();
    const definition = this.registry.require(libraryId);
    const active = this.activeInstallations.get(definition.id);

    if (active) {
      return active.promise;
    }

    const current = await this.refreshDefinition(definition);
    const installationStartedDuringRefresh =
      this.activeInstallations.get(definition.id);

    if (installationStartedDuringRefresh) {
      return installationStartedDuringRefresh.promise;
    }

    if (current.status === 'available') {
      return current;
    }
    if (current.status === 'invalid') {
      throw new AppError('EXTERNAL_LIBRARY_CONFLICT');
    }

    const controller = new AbortController();
    const task = this.performInstallation(
      definition,
      controller.signal,
    )
      .catch(async (error: unknown) => {
        if (isAbortError(error)) {
          return Promise.reject(error);
        }

        this.updateSnapshot(definition, 'failed', {
          errorCode: errorCode(error),
        });
        throw error;
      })
      .finally(async () => {
        if (this.activeInstallations.get(definition.id)?.promise === task) {
          this.activeInstallations.delete(definition.id);
        }

        if (controller.signal.aborted) {
          await this.refreshDefinition(definition).catch(
            (refreshError: unknown) => {
              this.logger.warn(
                '取消安装后刷新外部运行时状态失败',
                refreshError,
              );
            },
          );
        }
      });
    this.activeInstallations.set(definition.id, {
      controller,
      promise: task,
    });

    return task;
  }

  cancel(libraryId: string): void {
    this.activeInstallations.get(libraryId.trim())?.controller.abort();
  }

  async remove(libraryId: string): Promise<ExternalLibrarySnapshot> {
    await this.initialize();
    const definition = this.registry.require(libraryId);
    const active = this.activeInstallations.get(definition.id);

    if (active) {
      active.controller.abort();
      await active.promise.catch((error: unknown) => {
        if (!isAbortError(error)) {
          throw error;
        }
      });
    }

    const packageDefinition = this.selectPackage(definition);
    await this.pathManager.removeInstallation(
      this.settings.getExternalLibrariesPath(),
      definition,
      packageDefinition,
    );

    return this.refreshDefinition(definition);
  }

  async requireExecutable(libraryId: string): Promise<string> {
    await this.initialize();
    const definition = this.registry.require(libraryId);
    if (this.activeInstallations.has(definition.id)) {
      throw new AppError('EXTERNAL_LIBRARY_NOT_INSTALLED');
    }
    const packageDefinition = this.selectPackage(definition);
    const inspection = await this.inspect(
      definition,
      packageDefinition,
    );

    if (inspection.status !== 'available') {
      await this.refreshDefinition(definition);
      throw new AppError('EXTERNAL_LIBRARY_NOT_INSTALLED');
    }

    this.applyInspection(definition, packageDefinition, inspection);
    return inspection.executablePath;
  }

  subscribe(listener: ExternalLibraryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async initializeDefinitions(): Promise<void> {
    for (const definition of this.registry.list()) {
      this.updateSnapshot(definition, 'discovering');

      try {
        await this.refreshDefinition(definition);
      } catch (error) {
        this.updateSnapshot(definition, 'failed', {
          errorCode: errorCode(error),
        });
      }
    }
  }

  private async refreshDefinition(
    definition: ExternalLibraryDefinition,
  ): Promise<ExternalLibrarySnapshot> {
    const packageDefinition = this.selectPackage(definition);
    const inspection = await this.inspect(
      definition,
      packageDefinition,
    );
    return this.applyInspection(
      definition,
      packageDefinition,
      inspection,
    );
  }

  private async inspect(
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
  ): Promise<ExternalLibraryInstallationInspection> {
    const paths = this.pathManager.resolveInstallationPaths(
      this.settings.getExternalLibrariesPath(),
      definition,
      packageDefinition,
    );
    return this.installationStore.inspect(
      paths.installationDirectory,
      definition,
      packageDefinition,
    );
  }

  private applyInspection(
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
    inspection: ExternalLibraryInstallationInspection,
  ): ExternalLibrarySnapshot {
    const paths = this.pathManager.resolveInstallationPaths(
      this.settings.getExternalLibrariesPath(),
      definition,
      packageDefinition,
    );

    if (inspection.status === 'available') {
      return this.updateSnapshot(definition, 'available', {
        installationPath: paths.installationDirectory,
      });
    }
    if (inspection.status === 'invalid') {
      return this.updateSnapshot(definition, 'invalid', {
        installationPath: paths.installationDirectory,
        errorCode: inspection.reason,
      });
    }

    return this.updateSnapshot(definition, 'not-installed');
  }

  private async performInstallation(
    definition: ExternalLibraryDefinition,
    signal: AbortSignal,
  ): Promise<ExternalLibrarySnapshot> {
    const packageDefinition = this.selectPackage(definition);
    const rootPath = this.settings.getExternalLibrariesPath();
    const stagingDirectory =
      await this.pathManager.createStagingDirectory(
        rootPath,
        definition.id,
      );

    try {
      this.updateSnapshot(definition, 'downloading', {
        progress: {
          completedBytes: 0,
          totalBytes: packageDefinition.expectedSize,
        },
      });
      const packagePath = join(
        stagingDirectory,
        `package.${packageDefinition.packageType}.partial`,
      );
      const downloaded = await this.downloader.download({
        packageDefinition,
        destinationPath: packagePath,
        signal,
        onProgress: (progress) => {
          this.updateSnapshot(definition, 'downloading', { progress });
        },
        onVerifying: () => {
          this.updateSnapshot(definition, 'verifying');
        },
      });
      this.updateSnapshot(definition, 'installing');
      const stagingInstallationDirectory = join(
        stagingDirectory,
        'installation',
      );
      const installer = this.installers.require(
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
        throw new DOMException(
          'External library installation cancelled',
          'AbortError',
        );
      }

      await this.installationStore.write(
        stagingInstallationDirectory,
        createExternalLibraryInstallationMarker({
          definition,
          packageDefinition,
          installedTime: this.now(),
        }),
      );
      const paths = await this.pathManager.commitInstallation({
        rootPath,
        definition,
        packageDefinition,
        stagingDirectory,
        stagingInstallationDirectory,
      });
      const inspection = await this.installationStore.inspect(
        paths.installationDirectory,
        definition,
        packageDefinition,
      );

      if (inspection.status !== 'available') {
        throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
      }

      return this.applyInspection(
        definition,
        packageDefinition,
        inspection,
      );
    } finally {
      await this.pathManager
        .cleanupStagingDirectory(rootPath, stagingDirectory)
        .catch((error: unknown) => {
          this.logger.warn('清理外部运行时 staging 失败', error);
        });
    }
  }

  private selectPackage(
    definition: ExternalLibraryDefinition,
  ): ExternalLibraryPackageDefinition {
    return this.registry.selectPackage(
      definition.id,
      this.platform,
      this.architecture,
    );
  }

  private updateSnapshot(
    definition: ExternalLibraryDefinition,
    status: ExternalLibraryStatus,
    changes: Pick<
      ExternalLibrarySnapshot,
      'installationPath' | 'progress' | 'errorCode'
    > = {},
  ): ExternalLibrarySnapshot {
    const packageDefinition = this.selectPackage(definition);
    const snapshot = cloneExternalLibrarySnapshot({
      id: definition.id,
      displayName: definition.displayName,
      version: definition.version,
      expectedSize: packageDefinition.expectedSize,
      rootPath: this.settings.getExternalLibrariesPath(),
      status,
      ...(changes.installationPath === undefined
        ? {}
        : { installationPath: changes.installationPath }),
      ...(changes.progress === undefined
        ? {}
        : { progress: changes.progress }),
      ...(changes.errorCode === undefined
        ? {}
        : { errorCode: changes.errorCode }),
    });
    this.snapshots.set(definition.id, snapshot);

    for (const listener of this.listeners) {
      try {
        listener(cloneExternalLibrarySnapshot(snapshot));
      } catch (error) {
        this.logger.warn('外部运行时状态监听器执行失败', error);
      }
    }

    return cloneExternalLibrarySnapshot(snapshot);
  }
}
