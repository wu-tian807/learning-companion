function createTargetValiditySql(column: string): string {
  return `
    CASE
      WHEN json_valid(${column})
      THEN (
        json_extract(${column}, '$.scope') = 'asset'
        OR (
          json_extract(${column}, '$.scope') = 'content'
          AND typeof(json_extract(
            ${column},
            '$.anchorType'
          )) = 'text'
          AND length(trim(json_extract(
            ${column},
            '$.anchorType'
          ))) > 0
          AND typeof(json_extract(
            ${column},
            '$.anchorVersion'
          )) = 'integer'
          AND json_extract(${column}, '$.anchorVersion') > 0
          AND json_type(${column}, '$.anchorPayload') IS NOT NULL
        )
      )
      ELSE 0
    END
  `;
}

const attachmentGuardSql = `
  NOT (${createTargetValiditySql('NEW.target')})
  OR NOT EXISTS (
    SELECT 1
    FROM assets
    WHERE id = NEW.asset_id
      AND project_id = NEW.project_id
  )
`;

export const createAttachmentsMigration = Object.freeze({
  version: 19,
  sql: `
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY
        CHECK (length(trim(id)) > 0),
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      type_id TEXT NOT NULL
        CHECK (length(trim(type_id)) > 0),
      type_version INTEGER NOT NULL
        CHECK (type_version > 0),
      target TEXT NOT NULL,
      metadata TEXT NOT NULL,
      content_ref TEXT,
      content_media_type TEXT,
      created_time INTEGER NOT NULL
        CHECK (created_time >= 0),
      updated_time INTEGER NOT NULL
        CHECK (updated_time >= 0),
      FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS attachments_project_id_index
      ON attachments(project_id, created_time, id);
    CREATE INDEX IF NOT EXISTS attachments_asset_id_index
      ON attachments(asset_id, created_time, id);
    CREATE INDEX IF NOT EXISTS attachments_type_id_index
      ON attachments(type_id, type_version, asset_id);

    DROP TRIGGER IF EXISTS attachments_insert_guard;
    CREATE TRIGGER attachments_insert_guard
    BEFORE INSERT ON attachments
    WHEN ${attachmentGuardSql}
    BEGIN
      SELECT RAISE(ABORT, 'invalid Attachment');
    END;

    DROP TRIGGER IF EXISTS attachments_update_guard;
    CREATE TRIGGER attachments_update_guard
    BEFORE UPDATE OF
      project_id,
      asset_id,
      type_id,
      type_version,
      target
    ON attachments
    WHEN ${attachmentGuardSql}
    BEGIN
      SELECT RAISE(ABORT, 'invalid Attachment');
    END;
  `,
});
