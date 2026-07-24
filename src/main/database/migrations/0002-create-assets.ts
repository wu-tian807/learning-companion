export const createAssetsMigration = Object.freeze({
  version: 2,
  sql: `
    CREATE TABLE assets (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      content_kind TEXT NOT NULL CHECK (content_kind = 'local-file'),
      content_path TEXT NOT NULL,
      created_time INTEGER NOT NULL,
      last_used_time INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE
    );

    CREATE INDEX assets_project_id_index
      ON assets(project_id);
  `,
});
