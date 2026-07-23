import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { DatabaseContext } from './database-context';
import { createProjectsMigration } from './migrations/0001-create-projects';
import * as schema from './schema/projects';

interface DatabaseMigration {
  readonly version: number;
  readonly sql: string;
}

const migrations: readonly DatabaseMigration[] = [createProjectsMigration];

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
        continue;
      }

      if (migration.version !== appliedVersion + 1) {
        throw new Error(`数据库迁移版本不连续：${migration.version}`);
      }

      sqlite.exec(migration.sql);
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
