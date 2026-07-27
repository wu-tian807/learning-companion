export const createAssetsTableSql = `
  CREATE TABLE assets (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    content_ref TEXT NOT NULL,
    created_time INTEGER NOT NULL,
    last_used_time INTEGER NOT NULL,
    FOREIGN KEY (project_id)
      REFERENCES projects(id)
      ON DELETE CASCADE,
    CHECK (json_valid(content_ref)),
    CHECK (
      (
        json_extract(content_ref, '$.kind') = 'local-file'
        AND typeof(json_extract(content_ref, '$.path')) = 'text'
        AND length(trim(json_extract(content_ref, '$.path'))) > 0
      )
      OR
      (
        json_extract(content_ref, '$.kind') = 'managed-json'
        AND typeof(json_extract(content_ref, '$.contentId')) = 'text'
        AND length(trim(json_extract(content_ref, '$.contentId'))) > 0
      )
    )
  );

  CREATE INDEX assets_project_id_index
    ON assets(project_id);
`;

export const createAssetsMigration = Object.freeze({
  version: 2,
  sql: createAssetsTableSql,
});
