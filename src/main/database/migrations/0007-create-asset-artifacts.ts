export const createAssetArtifactsMigration = Object.freeze({
  version: 7,
  sql: `
    CREATE TABLE asset_artifacts (
      asset_id TEXT NOT NULL,
      producer_id TEXT NOT NULL
        CHECK (length(trim(producer_id)) > 0),
      artifact_key TEXT NOT NULL
        CHECK (length(trim(artifact_key)) > 0),
      relative_path TEXT NOT NULL
        CHECK (length(trim(relative_path)) > 0),
      media_type TEXT NOT NULL
        CHECK (length(trim(media_type)) > 0),
      source_revision TEXT NOT NULL
        CHECK (length(trim(source_revision)) > 0),
      producer_version TEXT NOT NULL
        CHECK (length(trim(producer_version)) > 0),
      artifact_revision TEXT NOT NULL
        CHECK (length(trim(artifact_revision)) > 0),
      updated_time INTEGER NOT NULL
        CHECK (updated_time >= 0),
      PRIMARY KEY (asset_id, producer_id, artifact_key),
      FOREIGN KEY (asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE
    );

    CREATE INDEX asset_artifacts_asset_id_index
      ON asset_artifacts(asset_id);
  `,
});
