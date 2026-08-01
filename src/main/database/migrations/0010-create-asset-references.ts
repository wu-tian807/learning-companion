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

const assetReferenceGuardSql = `
  NOT (${createTargetValiditySql('NEW.source_target')})
  OR NOT EXISTS (
    SELECT 1
    FROM assets
    WHERE id = NEW.asset_id
      AND project_id = NEW.project_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM assets
    WHERE id = NEW.source_asset_id
      AND project_id = NEW.project_id
  )
`;

export const createAssetReferencesMigration = Object.freeze({
  version: 10,
  sql: `
    CREATE TABLE asset_references (
      id TEXT PRIMARY KEY
        CHECK (length(trim(id)) > 0),
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      source_asset_id TEXT NOT NULL,
      source_target TEXT NOT NULL,
      created_time INTEGER NOT NULL
        CHECK (created_time >= 0),
      FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE,
      FOREIGN KEY (source_asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE
    );

    CREATE INDEX asset_references_project_id_index
      ON asset_references(project_id, created_time, id);
    CREATE INDEX asset_references_asset_id_index
      ON asset_references(asset_id, created_time, id);
    CREATE INDEX asset_references_source_asset_id_index
      ON asset_references(source_asset_id, created_time, id);

    CREATE TRIGGER asset_references_insert_guard
    BEFORE INSERT ON asset_references
    WHEN ${assetReferenceGuardSql}
    BEGIN
      SELECT RAISE(ABORT, 'invalid AssetReference');
    END;

    CREATE TRIGGER asset_references_update_guard
    BEFORE UPDATE OF
      project_id,
      asset_id,
      source_asset_id,
      source_target
    ON asset_references
    WHEN ${assetReferenceGuardSql}
    BEGIN
      SELECT RAISE(ABORT, 'invalid AssetReference');
    END;
  `,
});
