import { isAbsolute, join, relative, sep } from "node:path";

import {
  cloneExternalLibrarySnapshot,
  type ExternalLibraryMigrationConflict,
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
  createExternalLibraryInstallationMarker,
  type ExternalLibraryInstallationInspection,
  ExternalLibraryInstallationStore,
} from "./external-library-installation-store";
import type { ExternalLibraryInstallerRegistryApi } from "./external-library-installer";
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

interface MigrationEntry {
  readonly definition: ExternalLibraryDefinition;
  readonly packageDefinition: ExternalLibraryPackageDefinition;
  readonly sourceInspection: ExternalLibraryInstallationInspection;
  readonly targetInspection: ExternalLibraryInstallationInspection;
}

interface StagedMigrationEntry extends MigrationEntry {
  readonly stagingDirectory: string;
  readonly stagingInstallationDirectory: string;
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

function isPathInside(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

export class ExternalLibraryService implements ExternalLibraryServiceApi {
  private readonly snapshots = new Map<string, ExternalLibrarySnapshot>();
  private readonly listeners = new Set<ExternalLibraryListener>();
  private readonly activeInstallations = new Map<string, ActiveInstallation>();
  private readonly platform: ExternalLibraryPlatform;
  private readonly architecture: ExternalLibraryArchitecture;
  private readonly now: () => number;
  private readonly logger: Pick<Console, "warn">;
  private initializationTask: Promise<void> | undefined;
  private migrationTask: Promise<ExternalLibraryMigrationResult> | undefined;
  private initialized = false;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly registry: ExternalLibraryRegistryApi,
    private readonly pathManager: ExternalLibraryPathManagerApi,
    private readonly installationStore: ExternalLibraryInstallationStore,
    private readonly downloader: ExternalLibraryDownloaderApi,
    private readonly installers: ExternalLibraryInstallerRegistryApi,
    dependencies: Partial<ExternalLibraryServiceDependencies> = {},
  ) {
    this.platform = dependencies.platform ?? resolveCurrentPlatform();
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
    const stagingDirectory = await this.pathManager.createStagingDirectory(
      rootPath,
      definition.id,
    );

    try {
      this.updateSnapshot(definition, "downloading", {
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
          this.updateSnapshot(definition, "downloading", { progress });
        },
        onVerifying: () => {
          this.updateSnapshot(definition, "verifying");
        },
      });
      this.updateSnapshot(definition, "installing");
      const stagingInstallationDirectory = join(
        stagingDirectory,
        "installation",
      );
      const installer = this.installers.require(packageDefinition.packageType);
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
          "External library installation cancelled",
          "AbortError",
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

      if (inspection.status !== "available") {
        throw new AppError("EXTERNAL_LIBRARY_INSTALL_FAILED");
      }

      return this.applyInspection(definition, packageDefinition, inspection);
    } finally {
      await this.pathManager
        .cleanupStagingDirectory(rootPath, stagingDirectory)
        .catch((error: unknown) => {
          this.logger.warn("清理外部运行时 staging 失败", error);
        });
    }
  }

  private async performMigration(
    targetRootPath: string,
    conflictResolution?: ExternalLibraryMigrationConflictResolution,
  ): Promise<ExternalLibraryMigrationResult> {
    const sourceRootPath = this.pathManager.normalizeRootPath(
      this.settings.getExternalLibrariesPath(),
    );
    const normalizedTargetRootPath =
      this.pathManager.normalizeRootPath(targetRootPath);

    if (sourceRootPath === normalizedTargetRootPath) {
      return Object.freeze({
        status: "completed",
        rootPath: normalizedTargetRootPath,
        conflicts: Object.freeze([]),
        libraries: Object.freeze([...this.list()]),
      });
    }
    if (
      isPathInside(sourceRootPath, normalizedTargetRootPath) ||
      isPathInside(normalizedTargetRootPath, sourceRootPath)
    ) {
      throw new AppError("EXTERNAL_LIBRARY_MIGRATION_FAILED");
    }

    const entryTasks: Promise<MigrationEntry>[] = [];

    for (const definition of this.registry.list()) {
      const packageDefinition = this.findPackage(definition);

      if (!packageDefinition) {
        continue;
      }

      entryTasks.push(
        (async (): Promise<MigrationEntry> => {
          const sourcePaths = this.pathManager.resolveInstallationPaths(
            sourceRootPath,
            definition,
            packageDefinition,
          );
          const targetPaths = this.pathManager.resolveInstallationPaths(
            normalizedTargetRootPath,
            definition,
            packageDefinition,
          );
          const [sourceInspection, targetInspection] =
            await Promise.all([
              this.installationStore.inspect(
                sourcePaths.installationDirectory,
                definition,
                packageDefinition,
              ),
              this.installationStore.inspect(
                targetPaths.installationDirectory,
                definition,
                packageDefinition,
              ),
            ]);

          return {
            definition,
            packageDefinition,
            sourceInspection,
            targetInspection,
          };
        })(),
      );
    }

    const entries = await Promise.all(entryTasks);
    const conflicts: ExternalLibraryMigrationConflict[] =
      entries.flatMap((entry) => {
        if (
          entry.sourceInspection.status !== "available" ||
          entry.targetInspection.status === "not-installed"
        ) {
          return [];
        }

        return [
          Object.freeze({
            libraryId: entry.definition.id,
            displayName: entry.definition.displayName,
            targetPath: this.pathManager.resolveInstallationPaths(
              normalizedTargetRootPath,
              entry.definition,
              entry.packageDefinition,
            ).installationDirectory,
            targetStatus: entry.targetInspection.status,
          }),
        ];
      });

    if (conflicts.length > 0 && conflictResolution === undefined) {
      return Object.freeze({
        status: "conflict",
        rootPath: normalizedTargetRootPath,
        conflicts: Object.freeze(conflicts),
        libraries: Object.freeze([...this.list()]),
      });
    }

    for (const entry of entries) {
      this.updateSnapshot(entry.definition, "migrating");
    }

    const stagedEntries: StagedMigrationEntry[] = [];
    const committedEntries: StagedMigrationEntry[] = [];
    let settingsUpdated = false;

    try {
      for (const entry of entries) {
        if (
          entry.sourceInspection.status !== "available" ||
          (entry.targetInspection.status !== "not-installed" &&
            conflictResolution === "keep-target")
        ) {
          continue;
        }

        const sourcePaths = this.pathManager.resolveInstallationPaths(
          sourceRootPath,
          entry.definition,
          entry.packageDefinition,
        );
        const staging =
          await this.pathManager.stageInstallationMigration({
            targetRootPath: normalizedTargetRootPath,
            libraryId: entry.definition.id,
            sourceInstallationDirectory:
              sourcePaths.installationDirectory,
          });
        const stagedEntry = {
          ...entry,
          ...staging,
        };
        stagedEntries.push(stagedEntry);
        const inspection = await this.installationStore.inspect(
          staging.stagingInstallationDirectory,
          entry.definition,
          entry.packageDefinition,
        );

        if (inspection.status !== "available") {
          throw new AppError("EXTERNAL_LIBRARY_MIGRATION_FAILED");
        }
      }

      for (const entry of stagedEntries) {
        await this.pathManager.commitInstallation({
          rootPath: normalizedTargetRootPath,
          definition: entry.definition,
          packageDefinition: entry.packageDefinition,
          stagingDirectory: entry.stagingDirectory,
          stagingInstallationDirectory:
            entry.stagingInstallationDirectory,
          replaceExisting:
            entry.targetInspection.status !== "not-installed",
        });
        committedEntries.push(entry);
      }

      await this.settings.updateExternalLibrariesPath(
        normalizedTargetRootPath,
      );
      settingsUpdated = true;

      for (const definition of this.registry.list()) {
        await this.refreshDefinition(definition);
      }

      await Promise.all(
        committedEntries.map(async (entry) => {
          await this.pathManager
            .removeInstallation(
              sourceRootPath,
              entry.definition,
              entry.packageDefinition,
            )
            .catch((error: unknown) => {
              this.logger.warn(
                `清理旧外部运行时失败：${entry.definition.id}`,
                error,
              );
            });
        }),
      );

      return Object.freeze({
        status: "completed",
        rootPath: normalizedTargetRootPath,
        conflicts: Object.freeze(conflicts),
        libraries: Object.freeze([...this.list()]),
      });
    } catch (error) {
      if (!settingsUpdated) {
        for (const entry of committedEntries.reverse()) {
          await this.pathManager
            .rollbackInstallationCommit({
              rootPath: normalizedTargetRootPath,
              definition: entry.definition,
              packageDefinition: entry.packageDefinition,
              stagingDirectory: entry.stagingDirectory,
            })
            .catch((rollbackError: unknown) => {
              this.logger.warn(
                `回滚外部运行时迁移失败：${entry.definition.id}`,
                rollbackError,
              );
            });
        }
      }

      for (const definition of this.registry.list()) {
        await this.refreshDefinition(definition).catch(() => undefined);
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("EXTERNAL_LIBRARY_MIGRATION_FAILED", {
        cause: error,
      });
    } finally {
      await Promise.all(
        stagedEntries.map((entry) =>
          this.pathManager
            .cleanupStagingDirectory(
              normalizedTargetRootPath,
              entry.stagingDirectory,
            )
            .catch((error: unknown) => {
              this.logger.warn(
                `清理外部运行时迁移 staging 失败：${entry.definition.id}`,
                error,
              );
            }),
        ),
      );
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
