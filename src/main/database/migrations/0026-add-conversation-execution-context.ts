import type Database from 'better-sqlite3';

import { PROJECT_CONVERSATION_MODE_ID } from '../../../shared/project-conversations';

function addMissingConversationExecutionColumns(
  sqlite: Database.Database,
): void {
  const columns = new Set(
    sqlite
      .prepare<[], { name: string }>(
        'PRAGMA table_info(project_conversations)',
      )
      .all()
      .map(({ name }) => name),
  );

  if (!columns.has('mode_id')) {
    sqlite.exec(`
      ALTER TABLE project_conversations
        ADD COLUMN mode_id TEXT NOT NULL
        DEFAULT '${PROJECT_CONVERSATION_MODE_ID}';
    `);
  }
  if (!columns.has('workspace_binding_json')) {
    sqlite.exec(`
      ALTER TABLE project_conversations
        ADD COLUMN workspace_binding_json TEXT
        CHECK (
          workspace_binding_json IS NULL OR
          json_valid(workspace_binding_json)
        );
    `);
  }
}

export const addConversationExecutionContextMigration = {
  version: 26,
  sql: '',
  apply: addMissingConversationExecutionColumns,
  reconcile: addMissingConversationExecutionColumns,
} as const;
