export const createAssetFoldersMigration = Object.freeze({
  version: 23,
  sql: `
    CREATE TABLE IF NOT EXISTS asset_folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      path TEXT NOT NULL COLLATE NOCASE,
      CONSTRAINT asset_folders_project_path_unique
        UNIQUE (project_id, path),
      FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_folder_assignments (
      asset_id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      FOREIGN KEY (asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE,
      FOREIGN KEY (folder_id)
        REFERENCES asset_folders(id)
    );

    CREATE INDEX IF NOT EXISTS asset_folder_assignments_folder_id_index
      ON asset_folder_assignments(folder_id);
  `,
});
