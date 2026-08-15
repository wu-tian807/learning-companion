export const retireLegacyGenerationPreparedDataMigration = Object.freeze({
  version: 22,
  sql: `
    UPDATE generation_tasks
    SET
      prepared_data_json = json_object('assetReferences', json('{}')),
      failure_json = CASE
        WHEN process_completed_time IS NULL AND cancelled_time IS NULL
        THEN NULL
        ELSE failure_json
      END,
      cancelled_time = CASE
        WHEN process_completed_time IS NULL AND cancelled_time IS NULL
        THEN updated_time
        ELSE cancelled_time
      END
    WHERE prepared_time IS NOT NULL
      AND json_type(prepared_data_json, '$.legacyManifestRef') = 'text';
  `,
});
