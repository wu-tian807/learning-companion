import {
  cloneExternalLibrarySnapshot,
  type ExternalLibraryMigrationConflictResolution,
  type ExternalLibraryMigrationResult,
  type ExternalLibrarySnapshot,
  type ExternalLibraryStatus,
} from "../../shared/external-libraries";
import { AppError } from "../errors/app-error";
import type { SettingsRepository } from "../settings/settings-repository";
import type {
  ExternalLibraryArchitecture,
  ExternalLibraryDefinition,
  ExternalLibraryPackageDefinition,
  ExternalLibraryPlatform,
} from "./external-library-definition";
import type { ExternalLibraryDownloaderApi } from "./external-library-downloader";
import {
  type ExternalLibraryInstallationInspection,
  ExternalLibraryInstallationStore,
} from "./external-library-installation-store";
import { ExternalLibraryInstallationWorkflow } from "./external-library-installation-workflow";
import type { ExternalLibraryInstallerRegistryApi } from "./external-library-installer";
import { ExternalLibraryMigrationWorkflow } from "./external-library-migration-workflow";
import type { ExternalLibraryPathManagerApi } from "./external-library-path-manager";
import type { ExternalLibraryRegistryApi } from "./external-library-registry";

export type ExternalLibraryListener = (
  snapshot: ExternalLibrarySnapshot,
) => void;

export interface ExternalLibraryServiceApi {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  list(): readonly ExternalLibrarySnapshot[];
  refresh(libraryId: string): Promise<ExternalLibrarySnapshot>;
  startInstallation(libraryId: string): Promise<ExternalLibrarySnapshot>;
  cancel(libraryId: string): void;
  remove(libraryId: string): Promise<ExternalLibrarySnapshot>;
  migrate(
    targetRootPath: string,
    conflictResolution?: ExternalLibraryMigrationConflictResolution,
  ): Promise<ExternalLibraryMigrationResult>;
  requireExecutable(libraryId: string): Promise<string>;
  subscribe(listener: ExternalLibraryListener): () => void;
}

export interface ExternalLibraryServiceDependencies {
  readonly platform: ExternalLibraryPlatform;
  readonly architecture: ExternalLibraryArchitecture;
  readonly now: () => number;
  readonly logger: Pick<Console, "warn">;
}

interface ActiveInstallation {
  readonly controller: AbortController;
  readonly promise: Promise<ExternalLibrarySnapshot>;
}

function resolveCurrentPlatform(): ExternalLibraryPlatform {
  if (process.platform === "darwin" || process.platform === "win32") {
    return process.platform;
  }

  throw new AppError("FEATURE_NOT_SUPPORTED");
}

function resolveCurrentArchitecture(): ExternalLibraryArchitecture {
  if (process.arch === "arm64" || process.arch === "x64") {
    return process.arch;
  }

  throw new AppError("FEATURE_NOT_SUPPORTED");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : "INTERNAL_ERROR";
}

export class ExternalLibraryService implements ExternalLibraryServiceApi {
  private readonly snapshots = new Map<string, ExternalLibrarySnapshot>();
  private readonly listeners = new Set<ExternalLibraryListener>();
  private readonly activeInstallations = new Map<string, ActiveInstallation>();
  private readonly platform: ExternalLibraryPlatform;
  private readonly architecture: ExternalLibraryArchitecture;
  private readonly now: () => number;
  private readonly logger: Pick<Console, "warn">;
  private readonly installationWorkflow:
    ExternalLibraryInstallationWorkflow;
  private readonly migrationWorkflow: ExternalLibraryMigrationWorkflow;
  private initializationTask: Promise<void> | undefined;
  private migrationTask: Promise<ExternalLibraryMigrationResult> | undefined;
  private initialized = false;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly registry: ExternalLibraryRegistryApi,
    private readonly pathManager: ExternalLibraryPathManagerApi,
    private readonly installationStore: ExternalLibraryInstallationStore,
    downloader: ExternalLibraryDownloaderApi,
    installers: ExternalLibraryInstallerRegistryApi,
    dependencies: Partial<ExternalLibraryServiceDependencies> = {},
  ) {
    this.platform = dependencies.platform ?? resolveCurrentPlatform();
    this.architecture =
      dependencies.architecture ?? resolveCurrentArchitecture();
    this.now = dependencies.now ?? Date.now;
    this.logger = dependencies.logger ?? console;
    this.installationWorkflow = new ExternalLibraryInstallationWorkflow({
      pathManager,
      installationStore,
      downloader,
      installers,
      now: this.now,
      logger: this.logger,
    });
    this.migrationWorkflow = new ExternalLibraryMigrationWorkflow({
      settings,
      pathManager,
      installationStore,
      logger: this.logger,
    });
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

  async shutdown(): Promise<void> {
    const installations = [...this.activeInstallations.values()];

    for (const installation of installations) {
      installation.controller.abort();
    }

    await Promise.allSettled(
      [
        ...installations.map((installation) => installation.promise),
        ...(this.migrationTask ? [this.migrationTask] : []),
      ],
    );
    this.listeners.clear();
  }

  list(): readonly ExternalLibrarySnapshot[] {
    if (!this.initialized) {
      throw new AppError("SERVICE_NOT_READY");
    }

    return this.registry.list().map((definition) => {
      const snapshot = this.snapshots.get(definition.id);

      if (!snapshot) {
        throw new AppError("DATA_INTEGRITY_ERROR");
      }

      return cloneExternalLibrarySnapshot(snapshot);
    });
  }

  async refresh(libraryId: string): Promise<ExternalLibrarySnapshot> {
    await this.initialize();
    const definition = this.registry.require(libraryId);
    if (this.migrationTask) {
      const snapshot = this.snapshots.get(definition.id);

      if (!snapshot) {
        throw new AppError("DATA_INTEGRITY_ERROR");
      }

      return cloneExternalLibrarySnapshot(snapshot);
    }
    const active = this.activeInstallations.get(definition.id);

    if (active) {
      const snapshot = this.snapshots.get(definition.id);

      if (!snapshot) {
        throw new AppError("DATA_INTEGRITY_ERROR");
      }

      return cloneExternalLibrarySnapshot(snapshot);
    }

    return this.refreshDefinition(definition);
  }

  async startInstallation(
    libraryId: string,
  ): Promise<ExternalLibrarySnapshot> {
    await this.initialize();
    if (this.migrationTask) {
      throw new AppError("EXTERNAL_LIBRARY_CONFLICT");
    }
    const definition = this.registry.require(libraryId);
    const active = this.activeInstallations.get(definition.id);

    if (active) {
      const snapshot = this.snapshots.get(definition.id);

      if (!snapshot) {
        throw new AppError("DATA_INTEGRITY_ERROR");
      }

      return cloneExternalLibrarySnapshot(snapshot);
    }

    const current = await this.refreshDefinition(definition);
    const installationStartedDuringRefresh = this.activeInstallations.get(
      definition.id,
    );

    if (installationStartedDuringRefresh) {
      const snapshot = this.snapshots.get(definition.id);

      if (!snapshot) {
        throw new AppError("DATA_INTEGRITY_ERROR");
      }

      return cloneExternalLibrarySnapshot(snapshot);
    }

    if (current.status === "available") {
      return current;
    }
    if (current.status === "unsupported") {
      throw new AppError("FEATURE_NOT_SUPPORTED");
    }
    if (current.status === "invalid") {
      throw new AppError("EXTERNAL_LIBRARY_CONFLICT");
    }

    const controller = new AbortController();
    this.updateSnapshot(definition, "downloading", {
      progress: {
        completedBytes: 0,
        totalBytes: this.selectPackage(definition).expectedSize,
      },
    });
    const task = this.performInstallation(definition, controller.signal)
      .catch(async (error: unknown) => {
        if (isAbortError(error)) {
          try {
            return await this.refreshDefinition(definition);
          } catch (refreshError) {
            this.logger.warn(
              "取消安装后刷新外部运行时状态失败",
              refreshError,
            );
            return this.updateSnapshot(definition, "failed", {
              errorCode: errorCode(refreshError),
            });
          }
        }

        this.logger.warn(
          `外部运行时后台安装失败：${definition.id}`,
          error,
        );
        return this.updateSnapshot(definition, "failed", {
          errorCode: errorCode(error),
        });
      })
      .finally(() => {
        if (this.activeInstallations.get(definition.id)?.promise === task) {
          this.activeInstallations.delete(definition.id);
        }
      });
    this.activeInstallations.set(definition.id, {
      controller,
      promise: task,
    });

    void task.catch((error: unknown) => {
      this.logger.warn(
        `外部运行时后台任务终态处理失败：${definition.id}`,
        error,
      );
    });

    const snapshot = this.snapshots.get(definition.id);

    if (!snapshot) {
      throw new AppError("DATA_INTEGRITY_ERROR");
    }

    return cloneExternalLibrarySnapshot(snapshot);
  }

  cancel(libraryId: string): void {
    this.activeInstallations.get(libraryId.trim())?.controller.abort();
  }

  async remove(libraryId: string): Promise<ExternalLibrarySnapshot> {
    await this.initialize();
    if (this.migrationTask) {
      throw new AppError("EXTERNAL_LIBRARY_CONFLICT");
    }
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

    if (!this.findPackage(definition)) {
      return this.refreshDefinition(definition);
    }

    const packageDefinition = this.selectPackage(definition);
    await this.pathManager.removeInstallation(
      this.settings.getExternalLibrariesPath(),
      definition,
      packageDefinition,
    );

    return this.refreshDefinition(definition);
  }

  async migrate(
    targetRootPath: string,
    conflictResolution?: ExternalLibraryMigrationConflictResolution,
  ): Promise<ExternalLibraryMigrationResult> {
    await this.initialize();

    if (
      this.migrationTask ||
      this.activeInstallations.size > 0
    ) {
      throw new AppError("EXTERNAL_LIBRARY_CONFLICT");
    }

    const task = this.performMigration(
      targetRootPath,
      conflictResolution,
    );
    this.migrationTask = task;

    try {
      return await task;
    } finally {
      if (this.migrationTask === task) {
        this.migrationTask = undefined;
      }
    }
  }

  async requireExecutable(libraryId: string): Promise<string> {
    await this.initialize();
    const definition = this.registry.require(libraryId);
    const currentSnapshot = this.snapshots.get(definition.id);
    if (
      this.migrationTask ||
      (this.activeInstallations.has(definition.id) &&
        currentSnapshot?.status !== "available")
    ) {
      throw new AppError("EXTERNAL_LIBRARY_NOT_INSTALLED");
    }
    const packageDefinition = this.selectPackage(definition);
    const inspection = await this.inspect(definition, packageDefinition);

    if (inspection.status !== "available") {
      await this.refreshDefinition(definition);
      throw new AppError("EXTERNAL_LIBRARY_NOT_INSTALLED");
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
      if (!this.findPackage(definition)) {
        this.updateSnapshot(definition, "unsupported");
        continue;
      }

      this.updateSnapshot(definition, "discovering");

      try {
        await this.refreshDefinition(definition);
      } catch (error) {
        this.updateSnapshot(definition, "failed", {
          errorCode: errorCode(error),
        });
      }
    }
  }

  private async refreshDefinition(
    definition: ExternalLibraryDefinition,
  ): Promise<ExternalLibrarySnapshot> {
    const packageDefinition = this.findPackage(definition);

    if (!packageDefinition) {
      return this.updateSnapshot(definition, "unsupported");
    }

    const inspection = await this.inspect(definition, packageDefinition);
    return this.applyInspection(definition, packageDefinition, inspection);
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

    if (inspection.status === "available") {
      return this.updateSnapshot(definition, "available", {
        installationPath: paths.installationDirectory,
      });
    }
    if (inspection.status === "invalid") {
      return this.updateSnapshot(definition, "invalid", {
        installationPath: paths.installationDirectory,
        errorCode: inspection.reason,
      });
    }

    return this.updateSnapshot(definition, "not-installed");
  }

  private async performInstallation(
    definition: ExternalLibraryDefinition,
    signal: AbortSignal,
  ): Promise<ExternalLibrarySnapshot> {
    const packageDefinition = this.selectPackage(definition);
    const rootPath = this.settings.getExternalLibrariesPath();
    const inspection = await this.installationWorkflow.run({
      rootPath,
      definition,
      packageDefinition,
      signal,
      onStage: (stage) => {
        this.updateSnapshot(
          definition,
          stage.status,
          stage.status === "downloading"
            ? { progress: stage.progress }
            : {},
        );
      },
    });

    return this.applyInspection(
      definition,
      packageDefinition,
      inspection,
    );
  }

  private async performMigration(
    targetRootPath: string,
    conflictResolution?: ExternalLibraryMigrationConflictResolution,
  ): Promise<ExternalLibraryMigrationResult> {
    const definitions = this.registry.list().flatMap((definition) => {
      const packageDefinition = this.findPackage(definition);

      return packageDefinition
        ? [{ definition, packageDefinition }]
        : [];
    });
    const outcome = await this.migrationWorkflow.run({
      targetRootPath,
      conflictResolution,
      definitions,
      onMigrating: (definition) => {
        this.updateSnapshot(definition, "migrating");
      },
      refreshDefinitions: async () => {
        let firstError: unknown;

        for (const definition of this.registry.list()) {
          try {
            await this.refreshDefinition(definition);
          } catch (error) {
            firstError ??= error;
          }
        }

        if (firstError !== undefined) {
          throw firstError;
        }
      },
    });

    return Object.freeze({
      ...outcome,
      libraries: Object.freeze([...this.list()]),
    });
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

  private findPackage(
    definition: ExternalLibraryDefinition,
  ): ExternalLibraryPackageDefinition | undefined {
    return this.registry.findPackage(
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
      "installationPath" | "progress" | "errorCode"
    > = {},
  ): ExternalLibrarySnapshot {
    const packageDefinition = this.findPackage(definition);

    if (
      (status === "unsupported" && packageDefinition) ||
      (status !== "unsupported" && !packageDefinition)
    ) {
      throw new AppError("DATA_INTEGRITY_ERROR");
    }

    const snapshot = cloneExternalLibrarySnapshot({
      id: definition.id,
      displayName: definition.displayName,
      version: definition.version,
      ...(packageDefinition
        ? { expectedSize: packageDefinition.expectedSize }
        : {}),
      rootPath: this.settings.getExternalLibrariesPath(),
      status,
      ...(changes.installationPath === undefined
        ? {}
        : { installationPath: changes.installationPath }),
      ...(changes.progress === undefined ? {} : { progress: changes.progress }),
      ...(changes.errorCode === undefined
        ? {}
        : { errorCode: changes.errorCode }),
    });
    this.snapshots.set(definition.id, snapshot);

    for (const listener of this.listeners) {
      try {
        listener(cloneExternalLibrarySnapshot(snapshot));
      } catch (error) {
        this.logger.warn("外部运行时状态监听器执行失败", error);
      }
    }

    return cloneExternalLibrarySnapshot(snapshot);
  }
}
