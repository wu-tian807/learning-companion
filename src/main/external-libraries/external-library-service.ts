import {
  cloneExternalLibrarySnapshot,
  type ExternalLibraryMigrationConflictResolution,
  type ExternalLibraryMigrationResult,
  type ExternalLibrarySnapshot,
  type ExternalLibraryStatus,
} from "../../shared/external-libraries";
import { AppError } from "../errors/app-error";
import type { SettingsRepository } from "../settings/settings-repository";
import {
  ExternalLibraryInstallationAbortError,
  isExternalLibraryAbortError,
} from "./external-library-abort";
import type {
  ExternalLibraryArchitecture,
  ExternalLibraryDefinition,
  ExternalLibraryPackageDefinition,
  ExternalLibraryPlatform,
} from "./external-library-definition";
import { externalLibraryPackageExpectedSize } from "./external-library-definition";
import type { ExternalLibraryDownloaderApi } from "./external-library-downloader";
import {
  type ExternalLibraryInstallationInspection,
  ExternalLibraryInstallationManifestFile,
} from "./external-library-installation-manifest-file";
import { ExternalLibraryInstallationWorkflow } from "./external-library-installation-workflow";
import type { ExternalLibraryInstallerRegistryApi } from "./external-library-installer";
import { ExternalLibraryMigrationWorkflow } from "./external-library-migration-workflow";
import type { ExternalLibraryPathManagerApi } from "./external-library-path-manager";
import type { ExternalLibraryRegistryApi } from "./external-library-registry";
import type { ExternalLibraryRuntimeSetupRegistryApi } from "./external-library-runtime-setup";

export type ExternalLibraryListener = (
  snapshot: ExternalLibrarySnapshot,
) => void;

export interface ExternalLibraryServiceApi {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  list(): readonly ExternalLibrarySnapshot[];
  refresh(libraryId: string): Promise<ExternalLibrarySnapshot>;
  startInstallation(
    libraryId: string,
    variantId?: string,
  ): Promise<ExternalLibrarySnapshot>;
  cancel(libraryId: string): void;
  remove(libraryId: string): Promise<ExternalLibrarySnapshot>;
  migrate(
    targetRootPath: string,
    conflictResolution?: ExternalLibraryMigrationConflictResolution,
  ): Promise<ExternalLibraryMigrationResult>;
  requireRuntime(libraryId: string): Promise<ExternalLibraryRuntime>;
  requireExecutable(libraryId: string): Promise<string>;
  subscribe(listener: ExternalLibraryListener): () => void;
}

export interface ExternalLibraryRuntime {
  readonly libraryId: string;
  readonly variantId?: string;
  readonly runtimeDirectory: string;
  readonly executablePath?: string;
}

export interface ExternalLibraryServiceDependencies {
  readonly platform: ExternalLibraryPlatform;
  readonly architecture: ExternalLibraryArchitecture;
  readonly now: () => number;
  readonly logger: Pick<Console, "warn">;
  readonly runtimeSetups: ExternalLibraryRuntimeSetupRegistryApi;
}

interface ActiveInstallation {
  readonly controller: AbortController;
  readonly variantId?: string;
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
    private readonly installationManifestFile: ExternalLibraryInstallationManifestFile,
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
      installationManifestFile,
      downloader,
      installers,
      runtimeSetups: dependencies.runtimeSetups,
      now: this.now,
      logger: this.logger,
    });
    this.migrationWorkflow = new ExternalLibraryMigrationWorkflow({
      settings,
      pathManager,
      installationManifestFile,
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

    const task = this.initializeService();
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
    variantId?: string,
  ): Promise<ExternalLibrarySnapshot> {
    await this.initialize();
    if (this.migrationTask) {
      throw new AppError("EXTERNAL_LIBRARY_CONFLICT");
    }
    const definition = this.registry.require(libraryId);
    const packageDefinition = this.selectPackage(definition, variantId);
    const active = this.activeInstallations.get(definition.id);

    if (active) {
      if (active.variantId !== packageDefinition.variantId) {
        throw new AppError("EXTERNAL_LIBRARY_CONFLICT");
      }
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

    if (
      current.status === "available" &&
      current.installedVariantId === packageDefinition.variantId
    ) {
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
        totalBytes: externalLibraryPackageExpectedSize(
          packageDefinition,
        ),
      },
      ...(packageDefinition.variantId === undefined
        ? {}
        : { operationVariantId: packageDefinition.variantId }),
    }, packageDefinition);
    const task = this.performInstallation(
      definition,
      packageDefinition,
      current.status === "available",
      controller.signal,
    )
      .catch(async (error: unknown) => {
        if (isExternalLibraryAbortError(error)) {
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
      ...(packageDefinition.variantId === undefined
        ? {}
        : { variantId: packageDefinition.variantId }),
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
    this.activeInstallations
      .get(libraryId.trim())
      ?.controller.abort(new ExternalLibraryInstallationAbortError(true));
  }

  async remove(libraryId: string): Promise<ExternalLibrarySnapshot> {
    await this.initialize();
    if (this.migrationTask) {
      throw new AppError("EXTERNAL_LIBRARY_CONFLICT");
    }
    const definition = this.registry.require(libraryId);
    const active = this.activeInstallations.get(definition.id);

    if (active) {
      active.controller.abort(
        new ExternalLibraryInstallationAbortError(true),
      );
      await active.promise.catch((error: unknown) => {
        if (!isExternalLibraryAbortError(error)) {
          throw error;
        }
      });
    }

    await this.pathManager.cleanupLibraryDownloads(
      this.settings.getExternalLibrariesPath(),
      definition,
    );

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

  async requireRuntime(libraryId: string): Promise<ExternalLibraryRuntime> {
    await this.initialize();
    const definition = this.registry.require(libraryId);
    if (this.findPackages(definition).length === 0) {
      throw new AppError("FEATURE_NOT_SUPPORTED");
    }
    const currentSnapshot = this.snapshots.get(definition.id);
    if (
      this.migrationTask ||
      (this.activeInstallations.has(definition.id) &&
        currentSnapshot?.status !== "available")
    ) {
      throw new AppError("EXTERNAL_LIBRARY_NOT_INSTALLED");
    }
    const installed = await this.inspectInstalledPackage(definition);

    if (!installed || installed.inspection.status !== "available") {
      await this.refreshDefinition(definition);
      throw new AppError("EXTERNAL_LIBRARY_NOT_INSTALLED");
    }

    const { packageDefinition, inspection } = installed;
    this.applyInspection(definition, packageDefinition, inspection);
    return Object.freeze({
      libraryId: definition.id,
      ...(packageDefinition.variantId === undefined
        ? {}
        : { variantId: packageDefinition.variantId }),
      runtimeDirectory: inspection.runtimeDirectory,
      ...(inspection.executablePath === undefined
        ? {}
        : { executablePath: inspection.executablePath }),
    });
  }

  async requireExecutable(libraryId: string): Promise<string> {
    const runtime = await this.requireRuntime(libraryId);

    if (!runtime.executablePath) {
      throw new AppError("FEATURE_NOT_SUPPORTED");
    }

    return runtime.executablePath;
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

  private async initializeService(): Promise<void> {
    await this.pathManager
      .cleanupExpiredTemporaryData(
        this.settings.getExternalLibrariesPath(),
        this.now(),
      )
      .catch((error: unknown) => {
        this.logger.warn(
          "清理过期外部运行时临时数据失败",
          error,
        );
      });
    await this.initializeDefinitions();
  }

  private async refreshDefinition(
    definition: ExternalLibraryDefinition,
  ): Promise<ExternalLibrarySnapshot> {
    const packages = this.findPackages(definition);

    if (packages.length === 0) {
      return this.updateSnapshot(definition, "unsupported");
    }

    let invalid:
      | {
          readonly packageDefinition: ExternalLibraryPackageDefinition;
          readonly inspection: Extract<
            ExternalLibraryInstallationInspection,
            { status: "invalid" }
          >;
        }
      | undefined;

    for (const packageDefinition of packages) {
      const inspection = await this.inspect(
        definition,
        packageDefinition,
      );

      if (inspection.status === "available") {
        return this.applyInspection(
          definition,
          packageDefinition,
          inspection,
        );
      }
      if (inspection.status === "invalid") {
        invalid ??= { packageDefinition, inspection };
      }
    }

    return invalid
      ? this.applyInspection(
          definition,
          invalid.packageDefinition,
          invalid.inspection,
        )
      : this.updateSnapshot(
          definition,
          "not-installed",
          {},
          this.selectPackage(definition),
        );
  }

  private async inspectInstalledPackage(
    definition: ExternalLibraryDefinition,
  ): Promise<
    | {
        readonly packageDefinition: ExternalLibraryPackageDefinition;
        readonly inspection: Extract<
          ExternalLibraryInstallationInspection,
          { status: "available" }
        >;
      }
    | undefined
  > {
    for (const packageDefinition of this.findPackages(definition)) {
      const inspection = await this.inspect(
        definition,
        packageDefinition,
      );
      if (inspection.status === "available") {
        return { packageDefinition, inspection };
      }
    }

    return undefined;
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
    return this.installationManifestFile.inspect(
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
        ...(packageDefinition.variantId === undefined
          ? {}
          : { installedVariantId: packageDefinition.variantId }),
      }, packageDefinition);
    }
    if (inspection.status === "invalid") {
      return this.updateSnapshot(definition, "invalid", {
        installationPath: paths.installationDirectory,
        errorCode: inspection.reason,
      }, packageDefinition);
    }

    return this.updateSnapshot(
      definition,
      "not-installed",
      {},
      packageDefinition,
    );
  }

  private async performInstallation(
    definition: ExternalLibraryDefinition,
    packageDefinition: ExternalLibraryPackageDefinition,
    replaceExisting: boolean,
    signal: AbortSignal,
  ): Promise<ExternalLibrarySnapshot> {
    const rootPath = this.settings.getExternalLibrariesPath();
    const inspection = await this.installationWorkflow.run({
      rootPath,
      definition,
      packageDefinition,
      replaceExisting,
      signal,
      onStage: (stage) => {
        this.updateSnapshot(
          definition,
          stage.status,
          stage.status === "downloading"
            ? {
                progress: stage.progress,
                ...(packageDefinition.variantId === undefined
                  ? {}
                  : {
                      operationVariantId:
                        packageDefinition.variantId,
                    }),
              }
            : packageDefinition.variantId === undefined
              ? {}
              : { operationVariantId: packageDefinition.variantId },
          packageDefinition,
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
    const definitions = [];
    for (const definition of this.registry.list()) {
      const installed = await this.inspectInstalledPackage(definition);
      const packageDefinition =
        installed?.packageDefinition ?? this.findPackage(definition);
      if (packageDefinition) {
        definitions.push({ definition, packageDefinition });
      }
    }
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
    variantId?: string,
  ): ExternalLibraryPackageDefinition {
    return this.registry.selectPackage(
      definition.id,
      this.platform,
      this.architecture,
      variantId,
    );
  }

  private findPackage(
    definition: ExternalLibraryDefinition,
    variantId?: string,
  ): ExternalLibraryPackageDefinition | undefined {
    return this.registry.findPackage(
      definition.id,
      this.platform,
      this.architecture,
      variantId,
    );
  }

  private findPackages(
    definition: ExternalLibraryDefinition,
  ): readonly ExternalLibraryPackageDefinition[] {
    return this.registry.findPackages(
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
      | "installationPath"
      | "progress"
      | "errorCode"
      | "installedVariantId"
      | "operationVariantId"
    > = {},
    selectedPackage = this.findPackage(definition),
  ): ExternalLibrarySnapshot {
    const packages = this.findPackages(definition);

    if (
      (status === "unsupported" && packages.length > 0) ||
      (status !== "unsupported" && !selectedPackage)
    ) {
      throw new AppError("DATA_INTEGRITY_ERROR");
    }

    const variants =
      definition.variants === undefined || packages.length === 0
        ? undefined
        : definition.variants.flatMap((variant) => {
            const packageDefinition = packages.find(
              ({ variantId }) => variantId === variant.id,
            );
            return packageDefinition
              ? [
                  Object.freeze({
                    id: variant.id,
                    displayName: variant.displayName,
                    expectedSize:
                      externalLibraryPackageExpectedSize(
                        packageDefinition,
                      ),
                  }),
                ]
              : [];
          });

    const snapshot = cloneExternalLibrarySnapshot({
      id: definition.id,
      displayName: definition.displayName,
      description: definition.description,
      category: definition.category,
      version: definition.version,
      ...(selectedPackage
        ? {
            expectedSize:
              externalLibraryPackageExpectedSize(selectedPackage),
          }
        : {}),
      ...(variants === undefined
        ? {}
        : {
            variants: Object.freeze(variants),
            defaultVariantId: definition.defaultVariantId,
            ...(changes.installedVariantId === undefined
              ? {}
              : {
                  installedVariantId: changes.installedVariantId,
                }),
            ...(changes.operationVariantId === undefined
              ? {}
              : {
                  operationVariantId: changes.operationVariantId,
                }),
          }),
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
