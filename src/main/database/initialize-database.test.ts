import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { GenerationTaskDatabase } from '../generation/generation-task-database';
import { createProjectsMigration } from './migrations/0001-create-projects';
import { createAssetReferencesMigration } from './migrations/0010-create-asset-references';
import { createGenerationTasksMigration } from './migrations/0012-create-generation-tasks';
import { indexUnfinishedGenerationTasksMigration } from './migrations/0013-index-unfinished-generation-tasks';
import { initializeDatabase } from './initialize-database';

const temporaryDirectories: string[] = [];

async function createDatabaseFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'learning-companion-db-'));
  temporaryDirectories.push(directory);
  return join(directory, 'data', 'learning-companion.sqlite3');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('initializeDatabase', () => {
  it('creates the database and applies the Project and Asset migrations', async () => {
    const databaseFile = await createDatabaseFile();
    const context = initializeDatabase(databaseFile);

    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(25);
      expect(context.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      const tableNames = context.sqlite
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map(({ name }) => name);

      expect(tableNames).toEqual([
        'asset_artifacts',
        'asset_attachments',
        'asset_folder_assignments',
        'asset_folders',
        'asset_links',
        'asset_references',
        'assets',
        'generation_tasks',
        'project_conversations',
        'projects',
        'workbench_state_data',
        'workbench_states',
      ]);
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'assets_project_id_index'",
          )
          .get(),
      ).toEqual({ name: 'assets_project_id_index' });
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'asset_artifacts_asset_id_index'",
          )
          .get(),
      ).toEqual({ name: 'asset_artifacts_asset_id_index' });
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'asset_references_asset_id_index'",
          )
          .get(),
      ).toEqual({ name: 'asset_references_asset_id_index' });
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'asset_links_asset_id_index'",
          )
          .get(),
      ).toEqual({ name: 'asset_links_asset_id_index' });
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'generation_tasks_unfinished_project_created_index'",
          )
          .get(),
      ).toEqual({
        name: 'generation_tasks_unfinished_project_created_index',
      });
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            'PRAGMA table_info(generation_tasks)',
          )
          .all()
          .map(({ name }) => name),
      ).toContain('assigned_provider_id');
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            'PRAGMA table_info(generation_tasks)',
          )
          .all()
          .map(({ name }) => name),
      ).toEqual(
        expect.arrayContaining([
          'assigned_connection_id',
          'assigned_model_id',
          'assigned_reasoning_effort',
        ]),
      );
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            'PRAGMA table_info(generation_tasks)',
          )
          .all()
          .map(({ name }) => name),
      ).not.toContain('agent_output_ref');
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            'PRAGMA table_info(generation_tasks)',
          )
          .all()
          .map(({ name }) => name),
      ).toContain('agent_calls_json');
      const generationTaskColumns = context.sqlite
        .prepare<[], { name: string }>(
          'PRAGMA table_info(generation_tasks)',
        )
        .all()
        .map(({ name }) => name);
      expect(generationTaskColumns).toContain('prepared_data_json');
      expect(generationTaskColumns).not.toContain('prepared_manifest_ref');
      expect(
        context.sqlite
          .prepare<[], { name: string }>('PRAGMA table_info(assets)')
          .all()
          .map(({ name }) => name),
      ).not.toContain('folder_path');
    } finally {
      context.close();
    }
  });

  it('can initialize the same database again without repeating migrations', async () => {
    const databaseFile = await createDatabaseFile();
    const firstContext = initializeDatabase(databaseFile);
    firstContext.close();

    const secondContext = initializeDatabase(databaseFile);

    try {
      expect(secondContext.sqlite.pragma('user_version', { simple: true })).toBe(
        25,
      );
    } finally {
      secondContext.close();
    }
  });

  it('adds isolated logical Asset folder tables to version 22 without changing Assets', async () => {
    const databaseFile = await createDatabaseFile();
    const legacyContext = initializeDatabase(databaseFile);
    legacyContext.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project', 'Project', '📘', 1, 0, '/tmp/projects/project');
    legacyContext.sqlite
      .prepare(
        `INSERT INTO assets (
          id, project_id, name, media_type, creation_kind, content_ref,
          created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'asset',
        'project',
        '资料',
        'text/plain',
        'imported',
        JSON.stringify({
          kind: 'local-file',
          base: 'absolute',
          path: '/tmp/资料.txt',
        }),
        1,
        2,
      );
    legacyContext.sqlite.exec(`
      DROP TABLE asset_folder_assignments;
      DROP TABLE asset_folders;
      PRAGMA user_version = 22;
    `);
    legacyContext.close();

    const context = initializeDatabase(databaseFile);
    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(25);
      expect(
        context.sqlite
          .prepare<[], { id: string }>('SELECT id FROM assets')
          .all(),
      ).toEqual([{ id: 'asset' }]);
      expect(
        context.sqlite
          .prepare<[], { name: string }>('PRAGMA table_info(assets)')
          .all()
          .map(({ name }) => name),
      ).not.toContain('folder_path');
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('asset_folders', 'asset_folder_assignments') ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: 'asset_folder_assignments' },
        { name: 'asset_folders' },
      ]);
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'asset_folder_assignments_folder_id_index'",
          )
          .get(),
      ).toEqual({ name: 'asset_folder_assignments_folder_id_index' });
    } finally {
      context.close();
    }
  });

  it('adds the unfinished GenerationTask index to a version 12 database without losing tasks', async () => {
    const databaseFile = await createDatabaseFile();
    const legacyContext = initializeDatabase(databaseFile);

    legacyContext.sqlite.exec('DROP TABLE generation_tasks');
    legacyContext.sqlite.exec('DROP TABLE asset_attachments');
    legacyContext.sqlite.exec(createGenerationTasksMigration.sql);

    legacyContext.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project', 'Project', '📘', 1, 0, '/tmp/projects/project');
    legacyContext.sqlite
      .prepare(
        `INSERT INTO generation_tasks (
          id, project_id, definition_id, definition_version,
          instruction_json, asset_references_json, metrics_json,
          created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'task',
        'project',
        'mindmap.generate',
        1,
        JSON.stringify({ format: 'test', version: 1 }),
        JSON.stringify({ sources: [] }),
        JSON.stringify({
          agentExecutions: [],
          totalActiveDurationMs: 0,
        }),
        2,
        2,
      );
    legacyContext.sqlite.pragma('user_version = 12');
    legacyContext.close();

    const context = initializeDatabase(databaseFile);

    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(25);
      expect(
        context.sqlite
          .prepare<[], { id: string }>('SELECT id FROM generation_tasks')
          .all(),
      ).toEqual([{ id: 'task' }]);
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'generation_tasks_unfinished_project_created_index'",
          )
          .get(),
      ).toEqual({
        name: 'generation_tasks_unfinished_project_created_index',
      });
    } finally {
      context.close();
    }
  });

  it('backfills the assigned Provider and preserves completed version 13 history', async () => {
    const databaseFile = await createDatabaseFile();
    const legacyContext = initializeDatabase(databaseFile);

    legacyContext.sqlite.exec('DROP TABLE generation_tasks');
    legacyContext.sqlite.exec('DROP TABLE asset_attachments');
    legacyContext.sqlite.exec(createGenerationTasksMigration.sql);
    legacyContext.sqlite.exec(indexUnfinishedGenerationTasksMigration.sql);
    legacyContext.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project', 'Project', '📘', 1, 0, '/tmp/projects/project');
    legacyContext.sqlite
      .prepare(
        `INSERT INTO generation_tasks (
          id, project_id, definition_id, definition_version,
          instruction_json, asset_references_json,
          prepared_time, prepared_manifest_ref,
          agent_completed_time, agent_session_id, agent_output_ref,
          post_processed_time, post_process_result_json,
          metrics_json, created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'task',
        'project',
        'mindmap.generate',
        1,
        JSON.stringify({ format: 'test', version: 1 }),
        JSON.stringify({ sources: [] }),
        2,
        'control/prepared-manifest.json',
        4,
        'session-1',
        'control/agent-output.json',
        5,
        JSON.stringify({ resultAssetId: 'mindmap-1' }),
        JSON.stringify({
          prepareDurationMs: 1,
          agentExecutions: [
            {
              sessionId: 'session-1',
              providerId: 'codex',
              modelId: 'gpt-test',
              startedTime: 2,
              completedTime: 4,
              activeDurationMs: 2,
              turnCount: 1,
              repairTurnCount: 0,
            },
          ],
          totalActiveDurationMs: 3,
        }),
        1,
        5,
      );
    legacyContext.sqlite.pragma('user_version = 13');
    legacyContext.close();

    const context = initializeDatabase(databaseFile);

    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(25);
      expect(
        context.sqlite
          .prepare<
            [],
            { assignedProviderId: string; assignedConnectionId: string }
          >(
            `SELECT
               assigned_provider_id AS assignedProviderId,
               assigned_connection_id AS assignedConnectionId
             FROM generation_tasks
             WHERE id = 'task'`,
          )
          .get(),
      ).toEqual({
        assignedProviderId: 'codex',
        assignedConnectionId: 'codex-account',
      });
      const migrated = context.sqlite
        .prepare<
          [],
          {
            agentCalls: string;
            preparedData: string;
            processCompletedTime: number;
            processResult: string;
          }
        >(
          `SELECT
             agent_calls_json AS agentCalls,
             prepared_data_json AS preparedData,
             process_completed_time AS processCompletedTime,
             process_result_json AS processResult
           FROM generation_tasks
           WHERE id = 'task'`,
        )
        .get();
      expect(migrated?.processCompletedTime).toBe(5);
      expect(JSON.parse(migrated!.preparedData)).toEqual({
        assetReferences: {},
      });
      expect(
        new GenerationTaskDatabase(context).get('task')?.prepared,
      ).toMatchObject({
        completedTime: 2,
        assetReferences: {},
      });
      expect(JSON.parse(migrated!.agentCalls)).toEqual([
        {
          callKey: 'generate',
          purpose: 'generation',
          completedTime: 4,
          sessionId: 'session-1',
        },
      ]);
      expect(JSON.parse(migrated!.processResult)).toEqual({
        resultAssetId: 'mindmap-1',
      });
    } finally {
      context.close();
    }
  });

  it('upgrades a version 1 Project database without losing its rows', async () => {
    const databaseFile = await createDatabaseFile();
    await mkdir(dirname(databaseFile), { recursive: true });
    const legacyDatabase = new Database(databaseFile);

    legacyDatabase.exec(createProjectsMigration.sql);
    legacyDatabase
      .prepare(
        'INSERT INTO projects (id, name, icon, created_time, pinned) VALUES (?, ?, ?, ?, ?)',
      )
      .run('legacy-project', '旧 Project', '📘', 1_753_171_200_000, 0);
    legacyDatabase.pragma('user_version = 1');
    legacyDatabase.close();

    const context = initializeDatabase(databaseFile);

    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(25);
      expect(
        context.sqlite
          .prepare<[], { name: string }>('SELECT name FROM projects')
          .get(),
      ).toEqual({ name: '旧 Project' });
      expect(
        context.sqlite
          .prepare<{ name: string }, { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = @name",
          )
          .get({ name: 'assets' }),
      ).toEqual({ name: 'assets' });
    } finally {
      context.close();
    }
  });

  it('clears legacy Assets while preserving Projects during version 2 upgrade', async () => {
    const databaseFile = await createDatabaseFile();
    await mkdir(dirname(databaseFile), { recursive: true });
    const legacyDatabase = new Database(databaseFile);

    legacyDatabase.exec(`
      ${createProjectsMigration.sql}
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        content_kind TEXT NOT NULL CHECK (content_kind = 'local-file'),
        content_path TEXT NOT NULL,
        created_time INTEGER NOT NULL,
        last_used_time INTEGER NOT NULL,
        FOREIGN KEY (project_id)
          REFERENCES projects(id)
          ON DELETE CASCADE
      );
      CREATE INDEX assets_project_id_index ON assets(project_id);
    `);
    legacyDatabase
      .prepare(
        'INSERT INTO projects (id, name, icon, created_time, pinned) VALUES (?, ?, ?, ?, ?)',
      )
      .run('legacy-project', '保留的 Project', '📘', 1_753_171_200_000, 0);
    legacyDatabase
      .prepare(
        `INSERT INTO assets (
          id, project_id, name, media_type, content_kind, content_path,
          created_time, last_used_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-asset',
        'legacy-project',
        '清理的 Asset',
        'text/plain',
        'local-file',
        '/tmp/legacy.txt',
        1_753_171_200_000,
        1_753_171_200_000,
      );
    legacyDatabase.pragma('user_version = 2');
    legacyDatabase.close();

    const context = initializeDatabase(databaseFile);

    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(25);
      expect(
        context.sqlite
          .prepare<[], { id: string }>('SELECT id FROM projects')
          .all(),
      ).toEqual([{ id: 'legacy-project' }]);
      expect(
        context.sqlite
          .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM assets')
          .get(),
      ).toEqual({ count: 0 });
      expect(
        context.sqlite
          .prepare<[], { name: string }>('PRAGMA table_info(assets)')
          .all()
          .map(({ name }) => name),
      ).toEqual([
        'id',
        'project_id',
        'name',
        'media_type',
        'content_ref',
        'created_time',
        'updated_time',
        'creation_kind',
      ]);
    } finally {
      context.close();
    }
  });

  it('enforces Asset ContentRef JSON and cascades Project deletion', async () => {
    const databaseFile = await createDatabaseFile();
    const context = initializeDatabase(databaseFile);

    try {
      context.sqlite
        .prepare(
          `INSERT INTO projects (
            id, name, icon, created_time, pinned, workspace_path
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'project',
          'Project',
          '📘',
          1_753_171_200_000,
          0,
          '/tmp/projects/project',
        );
      const insertAsset = context.sqlite.prepare(
        `INSERT INTO assets (
          id,
          project_id,
          name,
          media_type,
          content_ref,
          created_time,
          updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      insertAsset.run(
        'asset',
        'project',
        '资料',
        'application/pdf',
        JSON.stringify({
          kind: 'local-file',
          base: 'absolute',
          path: '/tmp/example.pdf',
        }),
        1_753_171_200_000,
        1_753_171_200_000,
      );
      context.sqlite
        .prepare(
          'INSERT INTO asset_folders (id, project_id, path) VALUES (?, ?, ?)',
        )
        .run('folder', 'project', '课程');
      context.sqlite
        .prepare(
          'INSERT INTO asset_folder_assignments (asset_id, folder_id) VALUES (?, ?)',
        )
        .run('asset', 'folder');
      context.sqlite
        .prepare(
          `INSERT INTO asset_artifacts (
            asset_id,
            producer_id,
            artifact_key,
            relative_path,
            media_type,
            source_revision,
            producer_version,
            artifact_revision,
            updated_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'asset',
          'builtin.office.preview',
          'preview',
          '.learning-companion/artifacts/asset/preview.pdf',
          'application/pdf',
          'source-revision',
          'producer-version',
          'artifact-revision',
          1_753_171_200_000,
        );
      expect(() =>
        insertAsset.run(
          'invalid-kind',
          'project',
          '网页',
          'text/html',
          JSON.stringify({
            kind: 'web-url',
            url: 'https://example.com',
          }),
          1_753_171_200_000,
          1_753_171_200_000,
        ),
      ).toThrow();
      expect(() =>
        context.sqlite
          .prepare(
            `INSERT INTO assets (
              id,
              project_id,
              name,
              media_type,
              creation_kind,
              content_ref,
              created_time,
              updated_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'invalid-creation-kind',
            'project',
            '非法创建类型',
            'text/plain',
            'authored',
            JSON.stringify({
              kind: 'local-file',
              base: 'absolute',
              path: '/tmp/authored.txt',
            }),
            1_753_171_200_000,
            1_753_171_200_000,
          ),
      ).toThrow();
      expect(() =>
        insertAsset.run(
          'invalid-json',
          'project',
          '损坏数据',
          'text/plain',
          '{',
          1_753_171_200_000,
          1_753_171_200_000,
        ),
      ).toThrow();

      context.sqlite.prepare('DELETE FROM projects WHERE id = ?').run('project');

      expect(
        context.sqlite
          .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM assets')
          .get(),
      ).toEqual({ count: 0 });
      expect(
        context.sqlite
          .prepare<[], { count: number }>(
            'SELECT COUNT(*) AS count FROM asset_folder_assignments',
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        context.sqlite
          .prepare<[], { count: number }>(
            'SELECT COUNT(*) AS count FROM asset_folders',
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        context.sqlite
          .prepare<[], { count: number }>(
            'SELECT COUNT(*) AS count FROM asset_artifacts',
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      context.close();
    }
  });

  it('migrates legacy local refs and removes retired managed JSON Assets', async () => {
    const databaseFile = await createDatabaseFile();
    const legacyContext = initializeDatabase(databaseFile);

    legacyContext.sqlite.exec(`
      DROP TRIGGER assets_content_ref_insert_guard;
      DROP TRIGGER assets_content_ref_update_guard;
      DROP TABLE generation_tasks;
      DROP TABLE asset_links;
      DROP TABLE asset_references;
      DROP TABLE asset_artifacts;
      DROP TABLE asset_attachments;
      ALTER TABLE assets DROP COLUMN creation_kind;
      ALTER TABLE assets RENAME COLUMN updated_time TO last_used_time;
    `);
    legacyContext.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'project',
        'Project',
        '📘',
        1_753_171_200_000,
        0,
        '/tmp/projects/project',
      );
    const insertAsset = legacyContext.sqlite.prepare(
      `INSERT INTO assets (
        id, project_id, name, media_type, content_ref, created_time,
        last_used_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertAsset.run(
      'local',
      'project',
      '旧本地资料',
      'text/plain',
      JSON.stringify({ kind: 'local-file', path: '/tmp/legacy.txt' }),
      1_753_171_200_000,
      1_753_171_200_000,
    );
    insertAsset.run(
      'managed',
      'project',
      '旧托管内容',
      'application/json',
      JSON.stringify({ kind: 'managed-json', contentId: 'legacy' }),
      1_753_171_200_000,
      1_753_171_200_000,
    );
    legacyContext.sqlite.pragma('user_version = 5');
    legacyContext.close();

    const context = initializeDatabase(databaseFile);

    try {
      expect(
        context.sqlite
          .prepare<[], { id: string; contentRef: string }>(
            `SELECT id, content_ref AS contentRef
             FROM assets
             ORDER BY id`,
          )
          .all()
          .map((row) => ({
            id: row.id,
            contentRef: JSON.parse(row.contentRef),
          })),
      ).toEqual([
        {
          id: 'local',
          contentRef: {
            kind: 'local-file',
            base: 'absolute',
            path: '/tmp/legacy.txt',
          },
        },
      ]);
      expect(
        context.sqlite
          .prepare<[], { creationKind: string }>(
            `SELECT creation_kind AS creationKind
             FROM assets
             WHERE id = 'local'`,
          )
          .get(),
      ).toEqual({ creationKind: 'imported' });
    } finally {
      context.close();
    }
  });

  it('renames the legacy Asset time column without losing values', async () => {
    const databaseFile = await createDatabaseFile();
    const legacyContext = initializeDatabase(databaseFile);

    legacyContext.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'project',
        'Project',
        '📘',
        1_753_171_200_000,
        0,
        '/tmp/projects/project',
      );
    legacyContext.sqlite
      .prepare(
        `INSERT INTO assets (
          id, project_id, name, media_type, creation_kind, content_ref,
          created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'asset',
        'project',
        '资料',
        'text/plain',
        'imported',
        JSON.stringify({
          kind: 'local-file',
          base: 'absolute',
          path: '/tmp/asset.txt',
        }),
        1_753_171_200_000,
        1_753_257_600_000,
      );
    legacyContext.sqlite.exec(`
      DROP TABLE asset_links;
      DROP TABLE asset_references;
      DROP TABLE generation_tasks;
      DROP TABLE asset_attachments;
      ALTER TABLE assets RENAME COLUMN updated_time TO last_used_time;
    `);
    legacyContext.sqlite.pragma('user_version = 8');
    legacyContext.close();

    const context = initializeDatabase(databaseFile);

    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(25);
      expect(
        context.sqlite
          .prepare<[], { updatedTime: number }>(
            `SELECT updated_time AS updatedTime
             FROM assets
             WHERE id = 'asset'`,
          )
          .get(),
      ).toEqual({ updatedTime: 1_753_257_600_000 });
      expect(
        context.sqlite
          .prepare<[], { name: string }>('PRAGMA table_info(assets)')
          .all()
          .map(({ name }) => name),
      ).not.toContain('last_used_time');
    } finally {
      context.close();
    }
  });

  it('upgrades version 10 associations without retaining format targets', async () => {
    const databaseFile = await createDatabaseFile();
    const legacyContext = initializeDatabase(databaseFile);

    legacyContext.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project', 'Project', '📘', 1, 0, '/tmp/projects/project');
    const insertAsset = legacyContext.sqlite.prepare(
      `INSERT INTO assets (
        id, project_id, name, media_type, creation_kind, content_ref,
        created_time, updated_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const contentRef = JSON.stringify({
      kind: 'local-file',
      base: 'absolute',
      path: '/tmp/asset.txt',
    });
    insertAsset.run(
      'mindmap',
      'project',
      'Mind Map',
      'application/json',
      'generated',
      contentRef,
      1,
      1,
    );
    insertAsset.run(
      'pdf',
      'project',
      'PDF',
      'application/pdf',
      'imported',
      contentRef,
      1,
      1,
    );
    legacyContext.sqlite.exec(`
      DROP TABLE asset_links;
      DROP TABLE asset_references;
      DROP TABLE generation_tasks;
      ${createAssetReferencesMigration.sql}
    `);
    const insertReference = legacyContext.sqlite.prepare(
      `INSERT INTO asset_references (
        id, project_id, asset_id, source_asset_id, source_target,
        created_time
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertReference.run(
      'later',
      'project',
      'mindmap',
      'pdf',
      JSON.stringify({ scope: 'asset' }),
      2,
    );
    insertReference.run(
      'earlier',
      'project',
      'mindmap',
      'pdf',
      JSON.stringify({ scope: 'asset' }),
      1,
    );
    insertReference.run(
      'self',
      'project',
      'mindmap',
      'mindmap',
      JSON.stringify({ scope: 'asset' }),
      0,
    );
    legacyContext.sqlite.exec('DROP TABLE asset_attachments');
    legacyContext.sqlite.pragma('user_version = 10');
    legacyContext.close();

    const context = initializeDatabase(databaseFile);

    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(25);
      expect(
        context.sqlite
          .prepare<[], { name: string }>('PRAGMA table_info(asset_references)')
          .all()
          .map(({ name }) => name),
      ).toEqual([
        'id',
        'project_id',
        'asset_id',
        'source_asset_id',
        'created_time',
      ]);
      expect(
        context.sqlite
          .prepare<[], { id: string; sourceAssetId: string }>(
            `SELECT id, source_asset_id AS sourceAssetId
             FROM asset_references`,
          )
          .all(),
      ).toEqual([{ id: 'earlier', sourceAssetId: 'pdf' }]);
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_links'",
          )
          .get(),
      ).toEqual({ name: 'asset_links' });
    } finally {
      context.close();
    }
  });

  it('closes the underlying connection idempotently', async () => {
    const databaseFile = await createDatabaseFile();
    const context = initializeDatabase(databaseFile);

    context.close();
    context.close();

    expect(context.sqlite.open).toBe(false);
  });

  it('reconciles databases written by the legacy branch version 20 without losing attachments', async () => {
    const databaseFile = await createDatabaseFile();
    initializeDatabase(databaseFile).close();
    const legacy = new Database(databaseFile);
    legacy.pragma('foreign_keys = OFF');
    legacy.exec(`
      INSERT INTO projects (id, name, icon, created_time, pinned, workspace_path)
      VALUES ('project', 'Project', 'book', 1, 0, 'C:/workspace');
      INSERT INTO assets (
        id, project_id, name, media_type, content_ref, created_time, updated_time
      ) VALUES (
        'asset', 'project', 'Document', 'application/pdf',
        '{"kind":"local-file","base":"absolute","path":"C:/document.pdf"}', 1, 1
      );
      DROP TABLE asset_attachments;
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, asset_id TEXT NOT NULL,
        type_id TEXT NOT NULL, type_version INTEGER NOT NULL,
        target TEXT NOT NULL, metadata TEXT NOT NULL, content_ref TEXT,
        content_media_type TEXT, created_time INTEGER NOT NULL, updated_time INTEGER NOT NULL
      );
      INSERT INTO attachments VALUES (
        'annotation', 'project', 'asset', 'ai.annotation', 1,
        '{"scope":"asset"}',
        '{"contentFormat":"ai-annotation-v1","questionPreview":"question","timestamp":1}',
        NULL, NULL, 2, 1
      );
      ALTER TABLE generation_tasks
        ADD COLUMN prepared_manifest_ref TEXT;
      PRAGMA user_version = 20;
    `);
    legacy.close();

    const context = initializeDatabase(databaseFile);
    try {
      expect(context.sqlite.prepare(
        'SELECT id, created_time, updated_time FROM asset_attachments',
      ).get()).toEqual({ id: 'annotation', created_time: 2, updated_time: 2 });
      expect(context.sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'",
      ).get()).toBeUndefined();
    } finally {
      context.close();
    }
  });

  it('retires unfinished prepared tasks written by the earlier version 21 branch', async () => {
    const databaseFile = await createDatabaseFile();
    const earlier = initializeDatabase(databaseFile);
    earlier.sqlite.exec(`
      INSERT INTO projects (id, name, icon, created_time, pinned, workspace_path)
      VALUES ('project', 'Project', 'book', 1, 0, 'C:/workspace');
      INSERT INTO generation_tasks (
        id, project_id, definition_id, definition_version,
        instruction_json, asset_references_json,
        prepared_time, prepared_data_json,
        agent_calls_json, metrics_json, failure_json,
        created_time, updated_time
      ) VALUES (
        'legacy-task', 'project', 'mindmap.generate', 1,
        '{"format":"test","version":1}', '{"sources":[]}',
        2, '{"legacyManifestRef":"control/prepared-manifest.json"}',
        '[]',
        '{"prepareDurationMs":1,"agentExecutions":[],"totalActiveDurationMs":1}',
        '{"phase":"process","failedTime":3,"message":"legacy failure"}',
        1, 3
      );
      PRAGMA user_version = 21;
    `);
    earlier.close();

    const context = initializeDatabase(databaseFile);
    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(25);
      const migrated = context.sqlite
        .prepare<
          [],
          {
            cancelledTime: number;
            failure: string | null;
            preparedData: string;
          }
        >(
          `SELECT
             cancelled_time AS cancelledTime,
             failure_json AS failure,
             prepared_data_json AS preparedData
           FROM generation_tasks
           WHERE id = 'legacy-task'`,
        )
        .get();
      expect(migrated).toMatchObject({ cancelledTime: 3, failure: null });
      expect(JSON.parse(migrated!.preparedData)).toEqual({
        assetReferences: {},
      });
      const taskDatabase = new GenerationTaskDatabase(context);
      expect(taskDatabase.get('legacy-task')?.cancelledTime).toBe(3);
      expect(taskDatabase.listUnfinishedByProject('project')).toEqual([]);
    } finally {
      context.close();
    }
  });

  it('still rejects a database newer than the supported compatibility version', async () => {
    const databaseFile = await createDatabaseFile();
    initializeDatabase(databaseFile).close();
    const newer = new Database(databaseFile);
    newer.pragma('user_version = 26');
    newer.close();

    expect(() => initializeDatabase(databaseFile)).toThrow(/26/);
  });
});
