export const createProjectLearningNotesMigration = {
  version: 27,
  sql: `
    CREATE TABLE IF NOT EXISTS project_learning_notes (
      project_id TEXT PRIMARY KEY NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,
      markdown TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_time INTEGER NOT NULL
    );
  `,
} as const;
