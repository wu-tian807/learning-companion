export const assignGenerationTaskConnectionMigration = Object.freeze({
  version: 18,
  sql: `
    ALTER TABLE generation_tasks
      ADD COLUMN assigned_connection_id TEXT;

    UPDATE generation_tasks
      SET assigned_connection_id = assigned_provider_id || '-account'
      WHERE assigned_provider_id IS NOT NULL;
  `,
});
