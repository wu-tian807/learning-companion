import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { addConversationExecutionContextMigration } from './0026-add-conversation-execution-context';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const sqlite of databases.splice(0)) sqlite.close();
});

describe('migration 26 conversation execution context', () => {
  it('keeps existing conversations in the general mode with no explicit binding', () => {
    const sqlite = new Database(':memory:');
    databases.push(sqlite);
    sqlite.exec(`
      CREATE TABLE project_conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        created_time INTEGER NOT NULL,
        updated_time INTEGER NOT NULL
      );
      INSERT INTO project_conversations VALUES (
        'conversation-1', 'project-1', '旧对话', '[]', 1, 1
      );
    `);
    addConversationExecutionContextMigration.apply(sqlite);

    expect(
      sqlite.prepare(`
        SELECT mode_id AS modeId,
               workspace_binding_json AS workspace
        FROM project_conversations
      `).get(),
    ).toEqual({ modeId: 'project.general', workspace: null });
  });

  it('reconciles an already upgraded table without adding duplicate columns', () => {
    const sqlite = new Database(':memory:');
    databases.push(sqlite);
    sqlite.exec(`
      CREATE TABLE project_conversations (
        id TEXT PRIMARY KEY,
        mode_id TEXT NOT NULL,
        workspace_binding_json TEXT
      );
    `);

    expect(() =>
      addConversationExecutionContextMigration.reconcile(sqlite),
    ).not.toThrow();
    expect(
      sqlite.prepare('PRAGMA table_info(project_conversations)')
        .all()
        .map((column) => (column as { name: string }).name),
    ).toEqual(['id', 'mode_id', 'workspace_binding_json']);
  });
});
