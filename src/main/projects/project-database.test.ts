import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { projects } from '../database/schema/projects';
import { ProjectDatabase } from './project-database';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createDatabaseFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'learning-companion-projects-'));
  temporaryDirectories.push(directory);
  return join(directory, 'learning-companion.sqlite3');
}

function openContext(databaseFile: string): DatabaseContext {
  const context = initializeDatabase(databaseFile);
  contexts.push(context);
  return context;
}

async function createContext(): Promise<DatabaseContext> {
  return openContext(await createDatabaseFile());
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.close();
  }

  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('ProjectDatabase', () => {
  it('loads every database row into the in-memory Map once', async () => {
    const context = await createContext();
    context.db
      .insert(projects)
      .values({
        id: 'persisted',
        name: '已保存 Project',
        icon: '📚',
        createdTime: Date.parse('2026-07-22T08:00:00.000Z'),
        pinned: true,
        workspacePath: '/tmp/projects/persisted',
      })
      .run();
    const database = new ProjectDatabase(context);

    database.initialize();
    database.initialize();

    expect(database.list()).toEqual([
      {
        id: 'persisted',
        name: '已保存 Project',
        icon: '📚',
        createdTime: Date.parse('2026-07-22T08:00:00.000Z'),
        pinned: true,
        workspacePath: '/tmp/projects/persisted',
      },
    ]);
  });

  it('writes add, update and delete operations through to SQLite', async () => {
    const context = await createContext();
    const database = new ProjectDatabase(context);
    database.initialize();

    const created = database.add({
      id: 'created-project',
      name: '  新 Project  ',
      icon: '🧭',
      createdTime: Date.parse('2026-07-23T02:00:00.000Z'),
      workspacePath: '/tmp/projects/created-project',
    });
    const updated = database.update(created.id, {
      name: '新标题',
      pinned: true,
    });
    const moved = database.updateWorkspace(
      created.id,
      '/tmp/projects/moved-project',
    );

    expect(updated).toMatchObject({
      id: 'created-project',
      name: '新标题',
      icon: '🧭',
      pinned: true,
    });
    expect(moved.workspacePath).toBe('/tmp/projects/moved-project');
    expect(context.db.select().from(projects).all()).toEqual([
      {
        id: 'created-project',
        name: '新标题',
        icon: '🧭',
        createdTime: Date.parse('2026-07-23T02:00:00.000Z'),
        pinned: true,
        workspacePath: '/tmp/projects/moved-project',
      },
    ]);

    database.delete(created.id);

    expect(database.list()).toEqual([]);
    expect(context.db.select().from(projects).all()).toEqual([]);
  });

  it('restores Projects from SQLite after reopening the database', async () => {
    const databaseFile = await createDatabaseFile();
    const firstContext = openContext(databaseFile);
    const firstDatabase = new ProjectDatabase(firstContext);
    firstDatabase.initialize();
    firstDatabase.add({
      id: 'persisted',
      name: '跨启动 Project',
      icon: '📘',
      createdTime: Date.parse('2026-07-23T02:00:00.000Z'),
      workspacePath: '/tmp/projects/persisted',
    });
    firstContext.close();

    const secondContext = openContext(databaseFile);
    const secondDatabase = new ProjectDatabase(secondContext);
    secondDatabase.initialize();

    expect(secondDatabase.list()).toEqual([
      {
        id: 'persisted',
        name: '跨启动 Project',
        icon: '📘',
        createdTime: Date.parse('2026-07-23T02:00:00.000Z'),
        pinned: false,
        workspacePath: '/tmp/projects/persisted',
      },
    ]);
  });

  it('does not expose its Project object references', async () => {
    const context = await createContext();
    const database = new ProjectDatabase(context);
    database.initialize();
    const created = database.add({
      id: 'isolated',
      name: '隔离测试',
      icon: '📘',
      createdTime: Date.parse('2026-07-23T02:00:00.000Z'),
      workspacePath: '/tmp/projects/isolated',
    });

    expect(database.get(created.id)).not.toBe(created);
    expect(database.list()[0]).not.toBe(created);
    expect(database.get(created.id)?.createdTime).toBe(
      Date.parse('2026-07-23T02:00:00.000Z'),
    );
  });

  it('keeps the previous Map value when a database write fails', async () => {
    const context = await createContext();
    const database = new ProjectDatabase(context);
    database.initialize();
    database.add({
      id: 'stable',
      name: '旧标题',
      icon: '📘',
      createdTime: Date.parse('2026-07-23T02:00:00.000Z'),
      workspacePath: '/tmp/projects/stable',
    });
    context.sqlite.exec('DROP TABLE projects');

    expect(() => database.update('stable', { name: '新标题' })).toThrow();
    expect(database.get('stable')?.name).toBe('旧标题');
  });

  it('rejects access before initialization and invalid mutations', async () => {
    const context = await createContext();
    const database = new ProjectDatabase(context);

    expect(() => database.list()).toThrow('SERVICE_NOT_READY');

    database.initialize();

    expect(() => database.update('missing', { name: '新标题' })).toThrow(
      'PROJECT_NOT_FOUND',
    );
    expect(() => database.update('missing', {})).toThrow(
      'INVALID_IPC_REQUEST',
    );
    expect(() =>
      database.update('missing', { unknown: true } as never),
    ).toThrow('INVALID_IPC_REQUEST');
    expect(() => database.delete('missing')).toThrow('PROJECT_NOT_FOUND');
  });
});
