export const createProjectNotebookAssetsMigration = {
  version: 29,
  sql: `
    CREATE TABLE IF NOT EXISTS project_notebook_assets (
      project_id TEXT PRIMARY KEY NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,
      asset_id TEXT
        REFERENCES assets(id) ON DELETE SET NULL,
      updated_time INTEGER NOT NULL
    );
  `,
} as const;
