import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { initializeDatabase } from '../initialize-database';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('project_conversations migration', () => {
  it('moves valid legacy HTML history into the Project store and retires its old row', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-conversation-migration-'),
    );
    temporaryDirectories.push(directory);
    const databaseFile = join(directory, 'data.sqlite3');
    const legacy = initializeDatabase(databaseFile);
    legacy.sqlite
      .prepare(
        `INSERT INTO projects (
           id, name, icon, created_time, pinned, workspace_path
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project-1', 'Project', '📘', 1, 0, '/tmp/project-1');
    legacy.sqlite
      .prepare(
        `INSERT INTO assets (
           id, project_id, name, media_type, creation_kind, content_ref,
           created_time, updated_time
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'asset-1',
        'project-1',
        'HTML',
        'text/html',
        'imported',
        JSON.stringify({
          kind: 'local-file',
          base: 'absolute',
          path: '/tmp/source.html',
        }),
        1,
        2,
      );
    const anchor = {
      scope: 'content',
      anchorType: 'html.quote',
      anchorVersion: 1,
      anchorPayload: { exact: '注意力机制' },
    };
    legacy.sqlite
      .prepare(
        `INSERT INTO workbench_state_data (
           asset_id, workbench_id, data_key, data, updated_time
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'asset-1',
        'builtin.html',
        'html-conversations-v1',
        Buffer.from(
          JSON.stringify({
            format: 'learning-companion/html-conversation-index',
            version: 1,
            entries: [
              {
                id: 'html-conversation',
                anchor,
                question: '解释注意力机制',
                answer: '它让不同位置的信息直接交互。',
                createdTime: 100,
              },
            ],
          }),
        ),
        100,
      );
    legacy.sqlite.exec(`
      DROP TABLE project_conversations;
      PRAGMA user_version = 23;
    `);
    legacy.close();

    const migrated = initializeDatabase(databaseFile);
    try {
      expect(migrated.sqlite.pragma('user_version', { simple: true })).toBe(24);
      const row = migrated.sqlite
        .prepare<
          [],
          {
            id: string;
            projectId: string;
            title: string;
            messages: string;
            createdTime: number;
            updatedTime: number;
          }
        >(
          `SELECT
             id,
             project_id AS projectId,
             title,
             messages_json AS messages,
             created_time AS createdTime,
             updated_time AS updatedTime
           FROM project_conversations`,
        )
        .get();
      expect(row).toMatchObject({
        id: 'html-conversation',
        projectId: 'project-1',
        title: '解释注意力机制',
        createdTime: 100,
        updatedTime: 100,
      });
      expect(JSON.parse(row!.messages)).toEqual([
        {
          id: 'html-conversation:legacy-html:1',
          role: 'user',
          text: '解释注意力机制',
          createdTime: 100,
          context: anchor,
        },
        {
          id: 'html-conversation:legacy-html:2',
          role: 'assistant',
          text: '它让不同位置的信息直接交互。',
          createdTime: 100,
          replyToMessageId: 'html-conversation:legacy-html:1',
        },
      ]);
      expect(
        migrated.sqlite
          .prepare<[], { count: number }>(
            `SELECT COUNT(*) AS count
             FROM workbench_state_data
             WHERE workbench_id = 'builtin.html'
               AND data_key = 'html-conversations-v1'`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      migrated.close();
    }
  });

  it('keeps malformed legacy HTML history for manual recovery', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-conversation-migration-invalid-'),
    );
    temporaryDirectories.push(directory);
    const databaseFile = join(directory, 'data.sqlite3');
    const legacy = initializeDatabase(databaseFile);
    legacy.sqlite
      .prepare(
        `INSERT INTO projects (
           id, name, icon, created_time, pinned, workspace_path
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project-1', 'Project', '📘', 1, 0, '/tmp/project-1');
    legacy.sqlite
      .prepare(
        `INSERT INTO assets (
           id, project_id, name, media_type, creation_kind, content_ref,
           created_time, updated_time
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'asset-1',
        'project-1',
        'HTML',
        'text/html',
        'imported',
        JSON.stringify({
          kind: 'local-file',
          base: 'absolute',
          path: '/tmp/source.html',
        }),
        1,
        2,
      );
    legacy.sqlite
      .prepare(
        `INSERT INTO workbench_state_data (
           asset_id, workbench_id, data_key, data, updated_time
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'asset-1',
        'builtin.html',
        'html-conversations-v1',
        Buffer.from('{'),
        100,
      );
    legacy.sqlite.exec(`
      DROP TABLE project_conversations;
      PRAGMA user_version = 23;
    `);
    legacy.close();

    const migrated = initializeDatabase(databaseFile);
    try {
      expect(migrated.sqlite.pragma('user_version', { simple: true })).toBe(24);
      expect(
        migrated.sqlite
          .prepare<[], { count: number }>(
            'SELECT COUNT(*) AS count FROM project_conversations',
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        migrated.sqlite
          .prepare<[], { count: number }>(
            `SELECT COUNT(*) AS count
             FROM workbench_state_data
             WHERE workbench_id = 'builtin.html'
               AND data_key = 'html-conversations-v1'`,
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      migrated.close();
    }
  });
});
