import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createAbsoluteLocalFileContentRef } from '../content/content-ref';
import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import {
  assetFolderAssignments,
  assetFolders,
} from '../database/schema/asset-folders';
import { assets } from '../database/schema/assets';
import { projects } from '../database/schema/projects';
import { AssetFolderDatabase } from './asset-folder-database';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createContext(): Promise<DatabaseContext> {
  const directory = await mkdtemp(join(tmpdir(), 'lc-asset-folders-'));
  temporaryDirectories.push(directory);
  const context = initializeDatabase(join(directory, 'database.sqlite3'));
  contexts.push(context);
  return context;
}

function addProject(context: DatabaseContext, id = 'project'): void {
  context.db
    .insert(projects)
    .values({
      id,
      name: id,
      icon: '📘',
      createdTime: 1,
      pinned: false,
      workspacePath: `/tmp/${id}`,
    })
    .run();
}

function addAsset(
  context: DatabaseContext,
  input: {
    id: string;
    projectId?: string;
    creationKind?: 'imported' | 'generated';
    folderPath?: string;
  },
): void {
  context.db
    .insert(assets)
    .values({
      id: input.id,
      projectId: input.projectId ?? 'project',
      name: input.id,
      mediaType: 'text/plain',
      creationKind: input.creationKind ?? 'imported',
      contentRef: createAbsoluteLocalFileContentRef(`/tmp/${input.id}.txt`),
      createdTime: 10,
      updatedTime: 20,
    })
    .run();

  if (input.folderPath) {
    const folder = context.db
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(
        and(
          eq(assetFolders.projectId, input.projectId ?? 'project'),
          eq(assetFolders.path, input.folderPath),
        ),
      )
      .get();
    if (!folder) throw new Error('test folder missing');
    context.db
      .insert(assetFolderAssignments)
      .values({ assetId: input.id, folderId: folder.id })
      .run();
  }
}

afterEach(async () => {
  for (const context of contexts.splice(0)) context.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('AssetFolderDatabase', () => {
  it('creates only canonical paths whose parent exists', async () => {
    const context = await createContext();
    addProject(context);
    const database = new AssetFolderDatabase(context);

    expect(() => database.create('project', '课程/第一章')).toThrow(
      'ASSET_FOLDER_NOT_FOUND',
    );
    database.create('project', '课程');
    expect(database.create('project', '课程/第一章').folders).toEqual([
      { projectId: 'project', path: '课程' },
      { projectId: 'project', path: '课程/第一章' },
    ]);
    expect(() => database.create('project', '课程/第一章')).toThrow(
      'ASSET_FOLDER_CONFLICT',
    );
    expect(() => database.create('project', '课程/第一章 ')).toThrow();
  });

  it('uses case-insensitive folder identity while preserving case-only renames', async () => {
    const context = await createContext();
    addProject(context);
    const database = new AssetFolderDatabase(context);

    database.create('project', 'Course');
    expect(() => database.create('project', 'course')).toThrow(
      'ASSET_FOLDER_CONFLICT',
    );
    expect(database.update('project', 'Course', 'course').folders).toEqual([
      { projectId: 'project', path: 'course' },
    ]);
  });

  it('lists Asset assignments without exposing root as a fake folder', async () => {
    const context = await createContext();
    addProject(context);
    const database = new AssetFolderDatabase(context);
    database.create('project', '课程');
    addAsset(context, { id: 'inside', folderPath: '课程' });
    addAsset(context, { id: 'root' });

    expect(database.list('project')).toEqual({
      projectId: 'project',
      folders: [{ projectId: 'project', path: '课程' }],
      folderPathByAssetId: { inside: '课程' },
    });
  });

  it('rebases a folder tree and its Asset paths without touching Asset content', async () => {
    const context = await createContext();
    addProject(context);
    const database = new AssetFolderDatabase(context);
    database.create('project', '课程');
    database.create('project', '课程/第一章');
    database.create('project', '归档');
    addAsset(context, { id: 'note', folderPath: '课程/第一章' });
    const assetBeforeMove = context.db.select().from(assets).get();

    const state = database.update('project', '课程', '归档/课程 A');

    expect(state.folders.map(({ path }) => path)).toEqual([
      '归档',
      '归档/课程 A',
      '归档/课程 A/第一章',
    ]);
    expect(state.folderPathByAssetId).toEqual({
      note: '归档/课程 A/第一章',
    });
    expect(context.db.select().from(assets).get()).toEqual(assetBeforeMove);
    expect(context.db.select().from(assetFolderAssignments).all()).toHaveLength(
      1,
    );
  });

  it('rejects descendant moves and collisions before rewriting anything', async () => {
    const context = await createContext();
    addProject(context);
    const database = new AssetFolderDatabase(context);
    database.create('project', '课程');
    database.create('project', '课程/第一章');
    database.create('project', '归档');
    database.create('project', '归档/课程');

    expect(() =>
      database.update('project', '课程', '课程/第一章/课程'),
    ).toThrow('ASSET_FOLDER_INVALID_MOVE');
    expect(() => database.update('project', '课程', '归档/课程')).toThrow(
      'ASSET_FOLDER_CONFLICT',
    );
    expect(database.list('project').folders).toHaveLength(4);
  });

  it('moves only imported Assets and supports returning them to root', async () => {
    const context = await createContext();
    addProject(context);
    const database = new AssetFolderDatabase(context);
    database.create('project', '课程');
    addAsset(context, { id: 'imported' });
    addAsset(context, { id: 'generated', creationKind: 'generated' });

    expect(
      database.moveAssets('project', ['imported'], '课程')
        .folderPathByAssetId,
    ).toEqual({ imported: '课程' });
    expect(
      database.moveAssets('project', ['imported'], null)
        .folderPathByAssetId,
    ).toEqual({});
    expect(() =>
      database.moveAssets('project', ['generated'], '课程'),
    ).toThrow('ASSET_NOT_FOUND');
  });

  it('rejects a mixed-project batch before moving any Asset', async () => {
    const context = await createContext();
    addProject(context);
    addProject(context, 'another-project');
    const database = new AssetFolderDatabase(context);
    database.create('project', '课程');
    addAsset(context, { id: 'local' });
    addAsset(context, {
      id: 'foreign',
      projectId: 'another-project',
    });

    expect(() =>
      database.moveAssets('project', ['local', 'foreign'], '课程'),
    ).toThrow('ASSET_NOT_FOUND');
    expect(database.list('project').folderPathByAssetId).toEqual({});
  });

  it('deletes an empty tree but refuses to orphan Assets', async () => {
    const context = await createContext();
    addProject(context);
    const database = new AssetFolderDatabase(context);
    database.create('project', '课程');
    database.create('project', '课程/第一章');
    addAsset(context, { id: 'note', folderPath: '课程/第一章' });

    expect(database.listAssetIdsInTree('project', '课程')).toEqual(['note']);
    expect(() => database.deleteTree('project', '课程')).toThrow(
      'DATABASE_WRITE_CONFLICT',
    );
    context.db.delete(assets).run();
    expect(context.db.select().from(assetFolderAssignments).all()).toEqual([]);
    expect(database.deleteTree('project', '课程').folders).toEqual([]);
  });
});
