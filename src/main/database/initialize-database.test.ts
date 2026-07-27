import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createProjectsMigration } from './migrations/0001-create-projects';
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
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(3);
      expect(context.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      const tableNames = context.sqlite
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map(({ name }) => name);

      expect(tableNames).toEqual(['assets', 'projects']);
      expect(
        context.sqlite
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'assets_project_id_index'",
          )
          .get(),
      ).toEqual({ name: 'assets_project_id_index' });
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
        3,
      );
    } finally {
      secondContext.close();
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
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(3);
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
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(3);
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
        'last_used_time',
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
          'INSERT INTO projects (id, name, icon, created_time, pinned) VALUES (?, ?, ?, ?, ?)',
        )
        .run('project', 'Project', '📘', 1_753_171_200_000, 0);
      const insertAsset = context.sqlite.prepare(
        `INSERT INTO assets (
          id,
          project_id,
          name,
          media_type,
          content_ref,
          created_time,
          last_used_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      insertAsset.run(
        'asset',
        'project',
        '资料',
        'application/pdf',
        JSON.stringify({ kind: 'local-file', path: '/tmp/example.pdf' }),
        1_753_171_200_000,
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
});
