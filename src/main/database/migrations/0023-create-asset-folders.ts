import type Database from 'better-sqlite3';

export const createAssetFoldersMigration = Object.freeze({
  version: 23,
  sql: `
    CREATE TABLE IF NOT EXISTS asset_folders (
      project_id TEXT NOT NULL,
      path TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (project_id, path),
      FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE
    );
  `,
  apply(sqlite: Database.Database): void {
    const columns = sqlite
      .prepare<[], { name: string }>('PRAGMA table_info(assets)')
      .all();

    if (!columns.some(({ name }) => name === 'folder_path')) {
      sqlite.exec('ALTER TABLE assets ADD COLUMN folder_path TEXT');
    }

    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS assets_project_folder_path_index
        ON assets(project_id, folder_path)
    `);
  },
});
