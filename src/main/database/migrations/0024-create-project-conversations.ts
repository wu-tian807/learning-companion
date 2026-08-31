export const createProjectConversationsMigration = {
  version: 24,
  sql: `
    CREATE TABLE IF NOT EXISTS project_conversations (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      messages_json TEXT NOT NULL CHECK (json_valid(messages_json)),
      created_time INTEGER NOT NULL,
      updated_time INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS project_conversations_project_updated_index
      ON project_conversations(project_id, updated_time, id);
  `,
} as const;
