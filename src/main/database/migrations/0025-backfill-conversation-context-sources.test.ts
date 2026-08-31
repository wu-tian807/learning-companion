import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { backfillConversationContextSourcesMigration } from './0025-backfill-conversation-context-sources';

const databases: Database.Database[] = [];

function createDatabase(): Database.Database {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE project_conversations (
      id TEXT PRIMARY KEY, project_id TEXT, messages_json TEXT
    );
    CREATE TABLE generation_tasks (
      id TEXT PRIMARY KEY, project_id TEXT, definition_id TEXT,
      definition_version INTEGER, instruction_json TEXT,
      asset_references_json TEXT
    );
  `);
  return sqlite;
}

function instruction(overrides: Record<string, unknown> = {}) {
  return {
    format: 'learning-companion/workbench-conversation-instruction',
    version: 1,
    contextProviderId: 'video.frame-context',
    assetId: 'asset-video',
    conversationId: 'conversation-1',
    question: '这里发生了什么？',
    context: { target: { scope: 'content' } },
    commitAnswer: true,
    ...overrides,
  };
}

afterEach(() => {
  for (const sqlite of databases.splice(0)) sqlite.close();
});

describe('migration 25 conversation context sources', () => {
  it('recovers identity and reference sources from their generation tasks', () => {
    const sqlite = createDatabase();
    const messages = [
      { id: 'user-1', role: 'user', text: '这里发生了什么？', createdTime: 1,
        context: { target: { scope: 'content' } } },
      { id: 'assistant-1', role: 'assistant', text: '回答', createdTime: 2,
        replyToMessageId: 'user-1', generationTaskId: 'task-1' },
      { id: 'user-2', role: 'user', text: '解释图片', createdTime: 3,
        context: { target: { scope: 'content', anchorType: 'image.region' } } },
      { id: 'assistant-2', role: 'assistant', text: '回答', createdTime: 4,
        replyToMessageId: 'user-2', generationTaskId: 'task-2' },
    ];
    sqlite.prepare('INSERT INTO project_conversations VALUES (?, ?, ?)')
      .run('conversation-1', 'project-1', JSON.stringify(messages));
    const insert = sqlite.prepare('INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('task-1', 'project-1', 'workbench.conversation', 1,
      JSON.stringify(instruction()), '{}');
    insert.run('task-2', 'project-1', 'workbench.conversation', 1,
      JSON.stringify(instruction({
        contextProviderId: 'image.context', assetId: 'asset-image',
        question: '解释图片',
        context: messages[2]!.context,
        commitAnswer: undefined,
      })), JSON.stringify({ source: [{ assetId: 'asset-image' }] }));

    backfillConversationContextSourcesMigration.apply(sqlite);

    const row = sqlite.prepare('SELECT messages_json FROM project_conversations')
      .get() as { messages_json: string };
    const migrated = JSON.parse(row.messages_json);
    expect(migrated[0].contextSource).toEqual({
      contextProviderId: 'video.frame-context', assetId: 'asset-video',
      sourceAssetMode: 'identity', commitAnswer: true,
    });
    expect(migrated[2].contextSource).toEqual({
      contextProviderId: 'image.context', assetId: 'asset-image',
      sourceAssetMode: 'reference',
    });
  });

  it('leaves unmatched or already sourced messages untouched', () => {
    const sqlite = createDatabase();
    const messages = [
      { id: 'user-1', role: 'user', text: '问题', createdTime: 1,
        context: { target: { scope: 'content' } } },
      { id: 'user-2', role: 'user', text: '问题二', createdTime: 2,
        context: {}, contextSource: { contextProviderId: 'kept.context' } },
      { id: 'assistant-1', role: 'assistant', text: '旧回答', createdTime: 3,
        replyToMessageId: 'user-1', generationTaskId: 'broken-task' },
    ];
    sqlite.prepare('INSERT INTO project_conversations VALUES (?, ?, ?)')
      .run('conversation-1', 'project-1', JSON.stringify(messages));
    sqlite.prepare('INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?, ?)')
      .run('broken-task', 'project-1', 'workbench.conversation', 1,
        '{broken', '{}');

    expect(() => backfillConversationContextSourcesMigration.apply(sqlite))
      .not.toThrow();

    const row = sqlite.prepare('SELECT messages_json FROM project_conversations')
      .get() as { messages_json: string };
    expect(JSON.parse(row.messages_json)).toEqual(messages);
  });
});
