export const indexUnfinishedGenerationTasksMigration = Object.freeze({
  version: 13,
  sql: `
    CREATE INDEX generation_tasks_unfinished_project_created_index
      ON generation_tasks(project_id, created_time, id)
      WHERE post_processed_time IS NULL
        AND cancelled_time IS NULL;
  `,
});
