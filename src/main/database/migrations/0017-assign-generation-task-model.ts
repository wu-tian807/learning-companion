export const assignGenerationTaskModelMigration = Object.freeze({
  version: 17,
  sql: `
    ALTER TABLE generation_tasks
      ADD COLUMN assigned_model_id TEXT;

    ALTER TABLE generation_tasks
      ADD COLUMN assigned_reasoning_effort TEXT;
  `,
});
