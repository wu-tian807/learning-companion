export const assignGenerationTaskProviderMigration = {
  version: 14,
  sql: `
    ALTER TABLE generation_tasks
      ADD COLUMN assigned_provider_id TEXT;

    UPDATE generation_tasks
      SET assigned_provider_id = json_extract(
        metrics_json,
        '$.agentExecutions[0].providerId'
      )
      WHERE agent_completed_time IS NOT NULL
        AND json_type(
          metrics_json,
          '$.agentExecutions[0].providerId'
        ) = 'text';
  `,
} as const;
