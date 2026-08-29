import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { DatabaseContext } from './database-context';
import { createProjectsMigration } from './migrations/0001-create-projects';
import { createAssetsMigration } from './migrations/0002-create-assets';
import { recreateAssetsMigration } from './migrations/0003-recreate-assets';
import { createWorkbenchStateMigration } from './migrations/0004-create-workbench-state';
import { addProjectWorkspaceMigration } from './migrations/0005-add-project-workspace';
import { migrateLocalFileContentRefsMigration } from './migrations/0006-migrate-local-file-content-refs';
import { createAssetArtifactsMigration } from './migrations/0007-create-asset-artifacts';
import { addAssetCreationKindMigration } from './migrations/0008-add-asset-creation-kind';
import { renameAssetUpdatedTimeMigration } from './migrations/0009-rename-asset-updated-time';
import { createAssetReferencesMigration } from './migrations/0010-create-asset-references';
import { normalizeAssetAssociationsMigration } from './migrations/0011-normalize-asset-associations';
import { createGenerationTasksMigration } from './migrations/0012-create-generation-tasks';
import { indexUnfinishedGenerationTasksMigration } from './migrations/0013-index-unfinished-generation-tasks';
import { assignGenerationTaskProviderMigration } from './migrations/0014-assign-generation-task-provider';
import { removeGenerationAgentOutputRefMigration } from './migrations/0015-remove-generation-agent-output-ref';
import { processGenerationTasksMigration } from './migrations/0016-process-generation-tasks';
import { assignGenerationTaskModelMigration } from './migrations/0017-assign-generation-task-model';
import { assignGenerationTaskConnectionMigration } from './migrations/0018-assign-generation-task-connection';
import { createAssetAttachmentsMigration } from './migrations/0019-create-asset-attachments';
import { reconcileLegacyBranchSchemaMigration } from './migrations/0020-reconcile-legacy-branch-schema';
import { storeGenerationPreparedDataMigration } from './migrations/0021-store-generation-prepared-data';
import { retireLegacyGenerationPreparedDataMigration } from './migrations/0022-retire-legacy-generation-prepared-data';
import { createAssetFoldersMigration } from './migrations/0023-create-asset-folders';
import * as assetAttachmentSchema from './schema/asset-attachments';
import * as assetArtifactSchema from './schema/asset-artifacts';
import * as assetFolderSchema from './schema/asset-folders';
import * as assetLinkSchema from './schema/asset-links';
import * as assetReferenceSchema from './schema/asset-references';
import * as assetSchema from './schema/assets';
import * as generationTaskSchema from './schema/generation-tasks';
import * as projectSchema from './schema/projects';
import * as workbenchStateSchema from './schema/workbench-state';

interface DatabaseMigration {
  readonly version: number;
  readonly sql: string;
  apply?(sqlite: Database.Database): void;
  reconcile?(sqlite: Database.Database): void;
}

const migrations: readonly DatabaseMigration[] = [
  createProjectsMigration,
  createAssetsMigration,
  recreateAssetsMigration,
  createWorkbenchStateMigration,
  addProjectWorkspaceMigration,
  migrateLocalFileContentRefsMigration,
  createAssetArtifactsMigration,
  addAssetCreationKindMigration,
  renameAssetUpdatedTimeMigration,
  createAssetReferencesMigration,
  normalizeAssetAssociationsMigration,
  createGenerationTasksMigration,
  indexUnfinishedGenerationTasksMigration,
  assignGenerationTaskProviderMigration,
  removeGenerationAgentOutputRefMigration,
  processGenerationTasksMigration,
  assignGenerationTaskModelMigration,
  assignGenerationTaskConnectionMigration,
  createAssetAttachmentsMigration,
  reconcileLegacyBranchSchemaMigration,
  storeGenerationPreparedDataMigration,
  retireLegacyGenerationPreparedDataMigration,
  createAssetFoldersMigration,
];
const schema = {
  ...assetAttachmentSchema,
  ...assetFolderSchema,
  ...projectSchema,
  ...assetSchema,
  ...assetArtifactSchema,
  ...assetLinkSchema,
  ...assetReferenceSchema,
  ...generationTaskSchema,
  ...workbenchStateSchema,
};

function readUserVersion(sqlite: Database.Database): number {
  const version = sqlite.pragma('user_version', { simple: true });

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new Error('SQLite user_version 无效');
  }

  return version;
}

function applyMigrations(sqlite: Database.Database): void {
  const latestVersion = migrations.at(-1)?.version ?? 0;
  const currentVersion = readUserVersion(sqlite);

  if (currentVersion > latestVersion) {
    throw new Error(
      `数据库版本 ${currentVersion} 高于应用支持的版本 ${latestVersion}`,
    );
  }

  const migrate = sqlite.transaction(() => {
    let appliedVersion = currentVersion;

    for (const migration of migrations) {
      if (migration.version <= appliedVersion) {
        migration.reconcile?.(sqlite);
        continue;
      }

      if (migration.version !== appliedVersion + 1) {
        throw new Error(`数据库迁移版本不连续：${migration.version}`);
      }

      sqlite.exec(migration.sql);
      migration.apply?.(sqlite);
      sqlite.pragma(`user_version = ${migration.version}`);
      appliedVersion = migration.version;
    }
  });

  migrate.immediate();
}

export function initializeDatabase(databaseFile: string): DatabaseContext {
  mkdirSync(dirname(databaseFile), { recursive: true });

  const sqlite = new Database(databaseFile);

  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    applyMigrations(sqlite);

    const db = drizzle(sqlite, { schema });
    let closed = false;

    return Object.freeze({
      sqlite,
      db,
      close(): void {
        if (closed) {
          return;
        }

        sqlite.close();
        closed = true;
      },
    });
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
