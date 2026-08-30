import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConversationRecord } from '../../shared/project-conversations';
import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { ProjectDatabase } from '../projects/project-database';
import { ProjectConversationDatabase } from './project-conversation-database';

let context: DatabaseContext;
let directory: string;
let databaseFile: string;
let projects: ProjectDatabase;
let conversations: ProjectConversationDatabase;

function record(
  id: string,
  updatedTime = 2,
  title = `对话 ${id}`,
): ConversationRecord {
  return {
    id,
    title,
    messages: [
      { id: `${id}-question`, role: 'user', text: '问题', createdTime: 1 },
      {
        id: `${id}-answer`,
        role: 'assistant',
        text: '回答',
        replyToMessageId: `${id}-question`,
        createdTime: 2,
      },
    ],
    createdTime: 1,
    updatedTime,
  };
}

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-project-conversations-'),
  );
  databaseFile = join(directory, 'data.sqlite3');
  context = initializeDatabase(databaseFile);
  projects = new ProjectDatabase(context);
  projects.initialize();
  for (const id of ['project-1', 'project-2']) {
    projects.add({
      id,
      name: id,
      icon: '📘',
      createdTime: 1,
      workspacePath: `/tmp/${id}`,
    });
  }
  conversations = new ProjectConversationDatabase(context);
});

afterEach(async () => {
  context.close();
  await rm(directory, { recursive: true, force: true });
});

describe('ProjectConversationDatabase', () => {
  it('persists complete records, updates by stable id and ignores stale saves', () => {
    conversations.save('project-1', record('conversation', 5, '当前标题'));

    expect(conversations.list('project-1')).toEqual([
      record('conversation', 5, '当前标题'),
    ]);
    expect(
      conversations.save(
        'project-1',
        record('conversation', 4, '过期标题'),
      ),
    ).toEqual(record('conversation', 5, '当前标题'));
    conversations.save(
      'project-1',
      record('conversation', 6, '更新标题'),
    );

    expect(conversations.get('conversation')).toEqual({
      projectId: 'project-1',
      conversation: record('conversation', 6, '更新标题'),
    });
  });

  it('restores Project history after the application database is reopened', () => {
    conversations.save('project-1', record('persisted', 5));
    context.close();

    context = initializeDatabase(databaseFile);
    conversations = new ProjectConversationDatabase(context);

    expect(conversations.list('project-1')).toEqual([
      record('persisted', 5),
    ]);
  });

  it('imports a batch transactionally and never moves an id across Projects', () => {
    conversations.save('project-1', record('shared', 2));

    expect(() =>
      conversations.import('project-2', [
        record('new-record', 3),
        record('shared', 4),
      ]),
    ).toThrow();
    expect(conversations.list('project-2')).toEqual([]);
    expect(conversations.list('project-1')).toEqual([record('shared', 2)]);
  });

  it('removes one Project conversation and cascades all rows with Project deletion', () => {
    conversations.import('project-1', [record('one'), record('two', 3)]);
    conversations.remove('project-1', 'one');
    expect(conversations.list('project-1').map(({ id }) => id)).toEqual([
      'two',
    ]);

    projects.delete('project-1');
    expect(conversations.list('project-1')).toEqual([]);
    expect(conversations.get('two')).toBeUndefined();
  });

  it('rejects malformed records before writing partial data', () => {
    expect(() =>
      conversations.save('project-1', {
        ...record('invalid'),
        title: '',
      }),
    ).toThrow();
    expect(conversations.list('project-1')).toEqual([]);
  });

  it('keeps the newest bounded Project history when old stores are combined', () => {
    const insert = context.sqlite.prepare(
      `INSERT INTO project_conversations (
         id, project_id, title, messages_json, created_time, updated_time
       ) VALUES (?, 'project-1', ?, '[]', ?, ?)`,
    );
    context.sqlite.transaction(() => {
      for (let index = 0; index < 1_001; index += 1) {
        insert.run(`old-${index}`, `旧对话 ${index}`, index, index);
      }
    })();

    conversations.save('project-1', record('latest', 2_000));

    expect(conversations.list('project-1')).toHaveLength(1_000);
    expect(conversations.get('latest')).toBeDefined();
    expect(conversations.get('old-0')).toBeUndefined();
  });
});
