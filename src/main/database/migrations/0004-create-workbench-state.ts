export const createWorkbenchStateMigration = Object.freeze({
  version: 4,
  sql: `
    CREATE TABLE workbench_states (
      asset_id TEXT NOT NULL,
      workbench_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      payload TEXT NOT NULL CHECK (json_valid(payload)),
      updated_time INTEGER NOT NULL CHECK (updated_time >= 0),
      PRIMARY KEY (asset_id, workbench_id),
      FOREIGN KEY (asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE
    );

    CREATE INDEX workbench_states_asset_id_index
      ON workbench_states(asset_id);

    CREATE TABLE workbench_state_data (
      asset_id TEXT NOT NULL,
      workbench_id TEXT NOT NULL,
      data_key TEXT NOT NULL CHECK (length(trim(data_key)) > 0),
      data BLOB NOT NULL,
      updated_time INTEGER NOT NULL CHECK (updated_time >= 0),
      PRIMARY KEY (asset_id, workbench_id, data_key),
      FOREIGN KEY (asset_id)
        REFERENCES assets(id)
        ON DELETE CASCADE
    );

    CREATE INDEX workbench_state_data_asset_id_index
      ON workbench_state_data(asset_id);
  `,
});
