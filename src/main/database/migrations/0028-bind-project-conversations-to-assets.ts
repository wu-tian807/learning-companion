import type Database from 'better-sqlite3';

function addBoundAssetColumn(sqlite: Database.Database): void {
  const columns = new Set(
    sqlite
      .prepare<[], { name: string }>(
        'PRAGMA table_info(project_conversations)',
      )
      .all()
      .map(({ name }) => name),
  );

  if (!columns.has('bound_asset_id')) {
    sqlite.exec(`
      ALTER TABLE project_conversations
        ADD COLUMN bound_asset_id TEXT
        REFERENCES assets(id) ON DELETE SET NULL;
    `);
  }

  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      project_conversations_bound_asset_mode_index
      ON project_conversations(bound_asset_id, mode_id)
      WHERE bound_asset_id IS NOT NULL;
  `);
}

export const bindProjectConversationsToAssetsMigration = {
  version: 28,
  sql: '',
  apply: addBoundAssetColumn,
  reconcile: addBoundAssetColumn,
} as const;
