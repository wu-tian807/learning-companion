export const createAssetAttachmentsMigration = Object.freeze({
  version: 19,
  sql: `
    CREATE TABLE asset_attachments (
      id TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(id)) > 0),
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      type_id TEXT NOT NULL
        CHECK (length(trim(type_id)) > 0),
      type_version INTEGER NOT NULL
        CHECK (type_version > 0),
      target_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      content_ref_json TEXT,
      content_media_type TEXT,
      created_time INTEGER NOT NULL
        CHECK (created_time >= 0),
      updated_time INTEGER NOT NULL
        CHECK (updated_time >= created_time),
      CHECK (
        (content_ref_json IS NULL AND content_media_type IS NULL) OR
        (content_ref_json IS NOT NULL AND length(trim(content_media_type)) > 0)
      ),
      FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE
    );

    CREATE INDEX asset_attachments_asset_updated_index
      ON asset_attachments(asset_id, updated_time, id);
    CREATE INDEX asset_attachments_project_index
      ON asset_attachments(project_id);
  `,
});
