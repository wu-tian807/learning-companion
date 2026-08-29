import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createAbsoluteLocalFileContentRef,
  createProjectWorkspaceContentRef,
} from '../content/content-ref';
import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { assets } from '../database/schema/assets';
import { projects } from '../database/schema/projects';
import {
  AssetDatabase,
  type AssetDatabaseDependencies,
} from './asset-database';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createContext(): Promise<DatabaseContext> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-asset-db-'),
  );
  temporaryDirectories.push(directory);
  const context = initializeDatabase(join(directory, 'database.sqlite3'));
  contexts.push(context);
  return context;
}

function addProject(context: DatabaseContext, id: string): void {
  context.db
    .insert(projects)
    .values({
      id,
      name: `${id} Project`,
      icon: '📘',
      createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
      pinned: false,
      workspacePath: `/tmp/projects/${id}`,
    })
    .run();
}

function insertAsset(
  context: DatabaseContext,
  input: {
    id: string;
    projectId: string;
    path: string;
    name?: string;
  },
): void {
  context.db
    .insert(assets)
    .values({
      id: input.id,
      projectId: input.projectId,
      name: input.name ?? input.id,
      mediaType: 'text/markdown',
      creationKind: 'imported',
      contentRef: createAbsoluteLocalFileContentRef(input.path),
      createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
      updatedTime: Date.parse('2026-07-27T01:00:00.000Z'),
    })
    .run();
}

function createDatabase(
  context: DatabaseContext,
  dependencies: Partial<AssetDatabaseDependencies> = {},
): AssetDatabase {
  return new AssetDatabase(context, dependencies);
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.close();
  }

  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('AssetDatabase', () => {
  it('loads pure Asset data without checking the file system', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/tmp/missing.md',
    });
    const database = createDatabase(context);

    expect(database.listByProject('project')).toEqual([
      expect.objectContaining({
        id: 'asset',
        creationKind: 'imported',
        contentRef: {
          kind: 'local-file',
          base: 'absolute',
          path: '/tmp/missing.md',
        },
      }),
    ]);
  });

  it('rejects ContentRef JSON that violates the shared contract', async () => {
    const context = await createContext();
    addProject(context, 'project');
    context.sqlite.pragma('ignore_check_constraints = ON');
    context.sqlite.exec('DROP TRIGGER assets_content_ref_insert_guard');
    context.sqlite
      .prepare(
        `INSERT INTO assets (
          id, project_id, name, media_type, content_ref, created_time,
          updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'invalid',
        'project',
        '非法资料',
        'text/plain',
        JSON.stringify({ kind: 'remote-url', url: 'https://example.com' }),
        Date.parse('2026-07-27T01:00:00.000Z'),
        Date.parse('2026-07-27T01:00:00.000Z'),
      );
    context.sqlite.pragma('ignore_check_constraints = OFF');
    const database = createDatabase(context);

    expect(() => database.listByProject('project')).toThrow(
      'DATA_INTEGRITY_ERROR',
    );
  });

  it('queries Projects independently without retaining active state', async () => {
    const context = await createContext();
    addProject(context, 'project-a');
    addProject(context, 'project-b');
    insertAsset(context, {
      id: 'asset-a',
      projectId: 'project-a',
      path: '/tmp/a.md',
    });
    insertAsset(context, {
      id: 'asset-b',
      projectId: 'project-b',
      path: '/tmp/b.md',
    });
    const database = createDatabase(context);

    expect(
      database.listByProject('project-a').map(({ id }) => id),
    ).toEqual(['asset-a']);
    expect(
      database.listByProject('project-b').map(({ id }) => id),
    ).toEqual(['asset-b']);
    expect(
      database.listByProject('project-a').map(({ id }) => id),
    ).toEqual(['asset-a']);
  });

  it('adds, updates and deletes Asset data through SQLite', async () => {
    const context = await createContext();
    addProject(context, 'project');
    const database = createDatabase(context, {
      createId: () => 'asset',
      now: () => Date.parse('2026-07-27T02:00:00.000Z'),
    });
    const created = database.add('project', {
      name: '学习笔记',
      mediaType: 'text/markdown',
      creationKind: 'imported',
      contentRef: createAbsoluteLocalFileContentRef('/tmp/notes.md'),
    });
    const renamed = database.update('project', created.id, {
      name: '新标题',
    });
    const relinked = database.update('project', created.id, {
      contentRef: createAbsoluteLocalFileContentRef('/tmp/new-notes.md'),
      updatedTime: Date.parse('2026-07-27T03:00:00.000Z'),
    });

    expect(renamed.name).toBe('新标题');
    expect(relinked).toMatchObject({
      name: '新标题',
      contentRef: { path: '/tmp/new-notes.md' },
    });
    expect(context.db.select().from(assets).get()).toMatchObject({
      id: 'asset',
      name: '新标题',
      creationKind: 'imported',
      contentRef: {
        kind: 'local-file',
        base: 'absolute',
        path: '/tmp/new-notes.md',
      },
      updatedTime: Date.parse('2026-07-27T03:00:00.000Z'),
    });

    database.delete('project', created.id);
    expect(database.listByProject('project')).toEqual([]);
    expect(context.db.select().from(assets).all()).toEqual([]);
  });

  it('stores Project Workspace relative ContentRefs', async () => {
    const context = await createContext();
    addProject(context, 'project');
    const database = createDatabase(context, {
      createId: () => 'generated',
    });
    const created = database.add('project', {
      name: '生成讲义',
      mediaType: 'text/markdown',
      creationKind: 'generated',
      contentRef: createProjectWorkspaceContentRef(
        'assets/generated/讲义.md',
      ),
    });

    expect(created.contentRef).toEqual({
      kind: 'local-file',
      base: 'project-workspace',
      path: 'assets/generated/讲义.md',
    });
    expect(created.creationKind).toBe('generated');
    expect(context.db.select().from(assets).get()?.contentRef).toEqual(
      created.contentRef,
    );
  });

  it('counts Assets without changing the active Project', async () => {
    const context = await createContext();
    addProject(context, 'project-a');
    addProject(context, 'project-b');
    addProject(context, 'project-empty');
    insertAsset(context, {
      id: 'asset-a',
      projectId: 'project-a',
      path: '/tmp/a.md',
    });
    insertAsset(context, {
      id: 'asset-b',
      projectId: 'project-b',
      path: '/tmp/b.md',
    });
    const database = createDatabase(context);

    expect(
      [...database.countByProjectIds([
        'project-a',
        'project-b',
        'project-empty',
      ])],
    ).toEqual([
      ['project-a', 1],
      ['project-b', 1],
      ['project-empty', 0],
    ]);
  });

  it('scopes writes to the explicit Project ID', async () => {
    const context = await createContext();
    addProject(context, 'project-a');
    addProject(context, 'project-b');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project-a',
      path: '/tmp/asset.txt',
    });
    const database = createDatabase(context);

    expect(() =>
      database.update('project-b', 'asset', { name: '错误项目' }),
    ).toThrow('ASSET_NOT_FOUND');
    expect(() => database.delete('project-b', 'asset')).toThrow(
      'ASSET_NOT_FOUND',
    );
    expect(database.listByProject('project-a')).toHaveLength(1);
  });
});
