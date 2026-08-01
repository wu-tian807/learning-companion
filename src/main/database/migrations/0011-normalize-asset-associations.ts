const assetReferenceGuardSql = `
  NEW.asset_id = NEW.source_asset_id
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

const assetLinkGuardSql = `
  NEW.asset_id = NEW.target_asset_id
  OR NOT EXISTS (
    SELECT 1
    FROM assets
    WHERE id = NEW.asset_id
      AND project_id = NEW.project_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM assets
    WHERE id = NEW.target_asset_id
      AND project_id = NEW.project_id
  )
`;

export const normalizeAssetAssociationsMigration = Object.freeze({
  version: 11,
  sql: `
    ALTER TABLE asset_references
      RENAME TO asset_references_v10;

    CREATE TABLE asset_references (
      id TEXT PRIMARY KEY
        CHECK (length(trim(id)) > 0),
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      source_asset_id TEXT NOT NULL,
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

    INSERT INTO asset_references (
      id,
      project_id,
      asset_id,
      source_asset_id,
      created_time
    )
    SELECT
      id,
      project_id,
      asset_id,
      source_asset_id,
      created_time
    FROM (
      SELECT
        id,
        project_id,
        asset_id,
        source_asset_id,
        created_time,
        ROW_NUMBER() OVER (
          PARTITION BY project_id, asset_id, source_asset_id
          ORDER BY created_time, id
        ) AS association_rank
      FROM asset_references_v10
      WHERE asset_id <> source_asset_id
    )
    WHERE association_rank = 1;

    DROP TABLE asset_references_v10;

    CREATE INDEX asset_references_project_id_index
      ON asset_references(project_id, created_time, id);
    CREATE INDEX asset_references_asset_id_index
      ON asset_references(asset_id, created_time, id);
    CREATE INDEX asset_references_source_asset_id_index
      ON asset_references(source_asset_id, created_time, id);
    CREATE UNIQUE INDEX asset_references_asset_source_unique
      ON asset_references(project_id, asset_id, source_asset_id);

    CREATE TRIGGER asset_references_insert_guard
    BEFORE INSERT ON asset_references
    WHEN ${assetReferenceGuardSql}
    BEGIN
      SELECT RAISE(ABORT, 'invalid AssetReference');
    END;

    CREATE TRIGGER asset_references_update_guard
    BEFORE UPDATE OF project_id, asset_id, source_asset_id
    ON asset_references
    WHEN ${assetReferenceGuardSql}
    BEGIN
      SELECT RAISE(ABORT, 'invalid AssetReference');
    END;

    CREATE TABLE asset_links (
      id TEXT PRIMARY KEY
        CHECK (length(trim(id)) > 0),
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      target_asset_id TEXT NOT NULL,
      created_time INTEGER NOT NULL
        CHECK (created_time >= 0),
      FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE,
      FOREIGN KEY (target_asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE
    );

    CREATE INDEX asset_links_project_id_index
      ON asset_links(project_id, created_time, id);
    CREATE INDEX asset_links_asset_id_index
      ON asset_links(asset_id, created_time, id);
    CREATE INDEX asset_links_target_asset_id_index
      ON asset_links(target_asset_id, created_time, id);
    CREATE UNIQUE INDEX asset_links_asset_target_unique
      ON asset_links(project_id, asset_id, target_asset_id);

    CREATE TRIGGER asset_links_insert_guard
    BEFORE INSERT ON asset_links
    WHEN ${assetLinkGuardSql}
    BEGIN
      SELECT RAISE(ABORT, 'invalid AssetLink');
    END;

    CREATE TRIGGER asset_links_update_guard
    BEFORE UPDATE OF project_id, asset_id, target_asset_id
    ON asset_links
    WHEN ${assetLinkGuardSql}
    BEGIN
      SELECT RAISE(ABORT, 'invalid AssetLink');
    END;
  `,
});
