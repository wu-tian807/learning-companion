import type {
  ExternalLibraryMigrationConflict,
  ExternalLibraryMigrationConflictResolution,
} from '../../shared/external-libraries';
import { AppError } from '../errors/app-error';
import { isPathInside } from '../filesystem/file-system-path-rules';
import type { SettingsRepository } from '../settings/settings-repository';
import type {
  ExternalLibraryDefinition,
  ExternalLibraryPackageDefinition,
} from './external-library-definition';
import type {
  ExternalLibraryInstallationInspection,
  ExternalLibraryInstallationStore,
} from './external-library-installation-store';
import type { ExternalLibraryPathManagerApi } from './external-library-path-manager';

export interface ExternalLibraryMigrationDefinition {
  readonly definition: ExternalLibraryDefinition;
  readonly packageDefinition: ExternalLibraryPackageDefinition;
}

export interface ExternalLibraryMigrationOutcome {
  readonly status: 'conflict' | 'completed';
  readonly rootPath: string;
  readonly conflicts: readonly ExternalLibraryMigrationConflict[];
}

export interface ExternalLibraryMigrationWorkflowDependencies {
  readonly settings: SettingsRepository;
  readonly pathManager: ExternalLibraryPathManagerApi;
  readonly installationStore: ExternalLibraryInstallationStore;
  readonly logger: Pick<Console, 'warn'>;
}

export interface ExternalLibraryMigrationWorkflowInput {
  readonly targetRootPath: string;
  readonly conflictResolution?:
    ExternalLibraryMigrationConflictResolution;
  readonly definitions: readonly ExternalLibraryMigrationDefinition[];
  readonly onMigrating: (
    definition: ExternalLibraryDefinition,
  ) => void;
  readonly refreshDefinitions: () => Promise<void>;
}

interface MigrationEntry extends ExternalLibraryMigrationDefinition {
  readonly sourceInspection: ExternalLibraryInstallationInspection;
  readonly targetInspection: ExternalLibraryInstallationInspection;
}

interface StagedMigrationEntry extends MigrationEntry {
  readonly stagingDirectory: string;
  readonly stagingInstallationDirectory: string;
}

export class ExternalLibraryMigrationWorkflow {
  constructor(
    private readonly dependencies:
      ExternalLibraryMigrationWorkflowDependencies,
  ) {}

  async run(
    input: ExternalLibraryMigrationWorkflowInput,
  ): Promise<ExternalLibraryMigrationOutcome> {
    const sourceRootPath =
      this.dependencies.pathManager.normalizeRootPath(
        this.dependencies.settings.getExternalLibrariesPath(),
      );
    const normalizedTargetRootPath =
      this.dependencies.pathManager.normalizeRootPath(
        input.targetRootPath,
      );

    if (sourceRootPath === normalizedTargetRootPath) {
      return Object.freeze({
        status: 'completed',
        rootPath: normalizedTargetRootPath,
        conflicts: Object.freeze([]),
      });
    }
    if (
      isPathInside(sourceRootPath, normalizedTargetRootPath) ||
      isPathInside(normalizedTargetRootPath, sourceRootPath)
    ) {
      throw new AppError('EXTERNAL_LIBRARY_MIGRATION_FAILED');
    }

    const entries = await Promise.all(
      input.definitions.map(
        async ({
          definition,
          packageDefinition,
        }): Promise<MigrationEntry> => {
          const sourcePaths =
            this.dependencies.pathManager.resolveInstallationPaths(
              sourceRootPath,
              definition,
              packageDefinition,
            );
          const targetPaths =
            this.dependencies.pathManager.resolveInstallationPaths(
              normalizedTargetRootPath,
              definition,
              packageDefinition,
            );
          const [sourceInspection, targetInspection] =
            await Promise.all([
              this.dependencies.installationStore.inspect(
                sourcePaths.installationDirectory,
                definition,
                packageDefinition,
              ),
              this.dependencies.installationStore.inspect(
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
        },
      ),
    );
    const conflicts: readonly ExternalLibraryMigrationConflict[] =
      Object.freeze(
        entries.flatMap((entry) => {
          if (
            entry.sourceInspection.status !== 'available' ||
            entry.targetInspection.status === 'not-installed'
          ) {
            return [];
          }

          return [
            Object.freeze({
              libraryId: entry.definition.id,
              displayName: entry.definition.displayName,
              targetPath:
                this.dependencies.pathManager.resolveInstallationPaths(
                  normalizedTargetRootPath,
                  entry.definition,
                  entry.packageDefinition,
                ).installationDirectory,
              targetStatus: entry.targetInspection.status,
            }),
          ];
        }),
      );

    if (
      conflicts.length > 0 &&
      input.conflictResolution === undefined
    ) {
      return Object.freeze({
        status: 'conflict',
        rootPath: normalizedTargetRootPath,
        conflicts,
      });
    }

    for (const entry of entries) {
      input.onMigrating(entry.definition);
    }

    const stagedEntries: StagedMigrationEntry[] = [];
    const committedEntries: StagedMigrationEntry[] = [];
    let settingsUpdated = false;

    try {
      for (const entry of entries) {
        if (
          entry.sourceInspection.status !== 'available' ||
          (entry.targetInspection.status !== 'not-installed' &&
            input.conflictResolution === 'keep-target')
        ) {
          continue;
        }

        const sourcePaths =
          this.dependencies.pathManager.resolveInstallationPaths(
            sourceRootPath,
            entry.definition,
            entry.packageDefinition,
          );
        const staging =
          await this.dependencies.pathManager.stageInstallationMigration({
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
        const inspection =
          await this.dependencies.installationStore.inspect(
            staging.stagingInstallationDirectory,
            entry.definition,
            entry.packageDefinition,
          );

        if (inspection.status !== 'available') {
          throw new AppError('EXTERNAL_LIBRARY_MIGRATION_FAILED');
        }
      }

      for (const entry of stagedEntries) {
        await this.dependencies.pathManager.commitInstallation({
          rootPath: normalizedTargetRootPath,
          definition: entry.definition,
          packageDefinition: entry.packageDefinition,
          stagingDirectory: entry.stagingDirectory,
          stagingInstallationDirectory:
            entry.stagingInstallationDirectory,
          replaceExisting:
            entry.targetInspection.status !== 'not-installed',
        });
        committedEntries.push(entry);
      }

      await this.dependencies.settings.updateExternalLibrariesPath(
        normalizedTargetRootPath,
      );
      settingsUpdated = true;
      await input.refreshDefinitions();

      await Promise.all(
        committedEntries.map(async (entry) => {
          await this.dependencies.pathManager
            .removeInstallation(
              sourceRootPath,
              entry.definition,
              entry.packageDefinition,
            )
            .catch((error: unknown) => {
              this.dependencies.logger.warn(
                `清理旧外部运行时失败：${entry.definition.id}`,
                error,
              );
            });
        }),
      );

      return Object.freeze({
        status: 'completed',
        rootPath: normalizedTargetRootPath,
        conflicts,
      });
    } catch (error) {
      if (!settingsUpdated) {
        for (const entry of committedEntries.reverse()) {
          await this.dependencies.pathManager
            .rollbackInstallationCommit({
              rootPath: normalizedTargetRootPath,
              definition: entry.definition,
              packageDefinition: entry.packageDefinition,
              stagingDirectory: entry.stagingDirectory,
            })
            .catch((rollbackError: unknown) => {
              this.dependencies.logger.warn(
                `回滚外部运行时迁移失败：${entry.definition.id}`,
                rollbackError,
              );
            });
        }
      }

      await input.refreshDefinitions().catch(() => undefined);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('EXTERNAL_LIBRARY_MIGRATION_FAILED', {
        cause: error,
      });
    } finally {
      await Promise.all(
        stagedEntries.map((entry) =>
          this.dependencies.pathManager
            .cleanupStagingDirectory(
              normalizedTargetRootPath,
              entry.stagingDirectory,
            )
            .catch((error: unknown) => {
              this.dependencies.logger.warn(
                `清理外部运行时迁移 staging 失败：${entry.definition.id}`,
                error,
              );
            }),
        ),
      );
    }
  }
}
