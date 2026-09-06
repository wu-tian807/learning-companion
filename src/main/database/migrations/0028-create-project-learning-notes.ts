import type Database from 'better-sqlite3';

import { canonicalizeAssetTargetsMigration } from './0027-canonicalize-asset-targets';

function tableExists(sqlite: Database.Database, tableName: string): boolean {
  return (
    sqlite
      .prepare<[string], { found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(tableName)?.found === 1
  );
}

export const createProjectLearningNotesMigration = {
  version: 28,
  sql: '',
  apply(sqlite: Database.Database): void {
    const upgradingFromLegacyLearningNotesVersion = tableExists(
      sqlite,
      'project_learning_notes',
    );

    // The pre-merge learning-note branch also used user_version 27. Databases
    // opened by that build contain this table but have not necessarily run the
    // canonical AssetTarget migration that now owns version 27 on main.
    if (upgradingFromLegacyLearningNotesVersion) {
      canonicalizeAssetTargetsMigration.apply(sqlite);
    }

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS project_learning_notes (
        project_id TEXT PRIMARY KEY NOT NULL
          REFERENCES projects(id) ON DELETE CASCADE,
        markdown TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_time INTEGER NOT NULL
      );
    `);
  },
} as const;
