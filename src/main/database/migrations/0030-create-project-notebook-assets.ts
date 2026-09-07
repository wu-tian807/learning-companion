export const createProjectNotebookAssetsMigration = {
  version: 30,
  sql: `
    CREATE TABLE IF NOT EXISTS project_notebook_assets (
      project_id TEXT PRIMARY KEY NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,
      asset_id TEXT
        REFERENCES assets(id) ON DELETE SET NULL,
      legacy_revision INTEGER,
      migration_operation_id TEXT,
      updated_time INTEGER NOT NULL
    );
  `,
} as const;
