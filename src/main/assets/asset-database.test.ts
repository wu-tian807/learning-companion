import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { assets } from '../database/schema/assets';
import { projects } from '../database/schema/projects';
import { ProjectDatabase } from '../projects/project-database';
import {
  AssetDatabase,
  type AssetDatabaseDependencies,
} from './asset-database';
import {
  createLocalFileContentLocator,
  DefaultLocalFileLocatorChecker,
  type LocalFileAvailability,
  type LocalFileLocatorChecker,
} from './asset-content-locator';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'learning-companion-assets-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createContext(): Promise<DatabaseContext> {
  const directory = await createTemporaryDirectory();
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
      createdTime: new Date('2026-07-24T01:00:00.000Z'),
      pinned: false,
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
    mediaType?: string;
  },
): void {
  context.db
    .insert(assets)
    .values({
      id: input.id,
      projectId: input.projectId,
      name: input.name ?? input.id,
      mediaType: input.mediaType ?? 'text/markdown',
      contentKind: 'local-file',
      contentPath: input.path,
      createdTime: new Date('2026-07-24T01:00:00.000Z'),
      lastUsedTime: new Date('2026-07-24T01:00:00.000Z'),
    })
    .run();
}

function createFixedChecker(
  getAvailability: () => LocalFileAvailability = () => 'available',
): LocalFileLocatorChecker {
  return {
    check: async (path) =>
      createLocalFileContentLocator({
        path,
        availability: getAvailability(),
        checkedTime: new Date('2026-07-24T02:00:00.000Z'),
      }),
  };
}

function createAssetDatabase(
  context: DatabaseContext,
  dependencies: Partial<AssetDatabaseDependencies> = {},
): AssetDatabase {
  const projectDatabase = new ProjectDatabase(context);
  projectDatabase.initialize();
  return new AssetDatabase(context, projectDatabase, dependencies);
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
  it('counts Assets for multiple Projects without loading their Maps', async () => {
    const context = await createContext();
    addProject(context, 'project-a');
    addProject(context, 'project-b');
    addProject(context, 'project-empty');
    insertAsset(context, {
      id: 'asset-a-1',
      projectId: 'project-a',
      path: '/tmp/a-1.md',
    });
    insertAsset(context, {
      id: 'asset-a-2',
      projectId: 'project-a',
      path: '/tmp/a-2.md',
    });
    insertAsset(context, {
      id: 'asset-b',
      projectId: 'project-b',
      path: '/tmp/b.md',
    });
    const database = createAssetDatabase(context);

    expect(
      [...database.countByProjectIds(['project-a', 'project-b', 'project-empty'])],
    ).toEqual([
      ['project-a', 2],
      ['project-b', 1],
      ['project-empty', 0],
    ]);
    expect(database.getActiveProjectId()).toBeUndefined();
    expect(database.countByProjectIds([]).size).toBe(0);
  });

  it('requires its ProjectLookup to be initialized', async () => {
    const context = await createContext();
    addProject(context, 'project');
    const projectDatabase = new ProjectDatabase(context);
    const database = new AssetDatabase(context, projectDatabase, {
      locatorChecker: createFixedChecker(),
    });

    await expect(database.loadFromProject('project')).rejects.toThrow(
      'ProjectDatabase 尚未初始化',
    );
  });

  it('requires an active Project for all Asset access', async () => {
    const context = await createContext();
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(),
    });

    expect(database.getActiveProjectId()).toBeUndefined();
    expect(() => database.list()).toThrow('AssetDatabase 尚未加载 Project');
    expect(() => database.get('asset')).toThrow(
      'AssetDatabase 尚未加载 Project',
    );
    await expect(database.add({ path: '/tmp/notes.md' })).rejects.toThrow(
      'AssetDatabase 尚未加载 Project',
    );
    expect(() => database.update('asset', { name: '标题' })).toThrow(
      'AssetDatabase 尚未加载 Project',
    );
    expect(() => database.delete('asset')).toThrow(
      'AssetDatabase 尚未加载 Project',
    );
    await expect(database.refreshAvailability('asset')).rejects.toThrow(
      'AssetDatabase 尚未加载 Project',
    );
    await expect(database.relink('asset', '/tmp/new.md')).rejects.toThrow(
      'AssetDatabase 尚未加载 Project',
    );
  });

  it('loads one Project at a time and unloads its Map', async () => {
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
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(),
    });

    await database.loadFromProject('project-a');

    expect(database.getActiveProjectId()).toBe('project-a');
    expect(database.list().map(({ id }) => id)).toEqual(['asset-a']);

    await database.loadFromProject('project-b');

    expect(database.getActiveProjectId()).toBe('project-b');
    expect(database.list().map(({ id }) => id)).toEqual(['asset-b']);
    expect(database.get('asset-a')).toBeUndefined();

    database.unloadProject();

    expect(database.getActiveProjectId()).toBeUndefined();
    expect(() => database.list()).toThrow('AssetDatabase 尚未加载 Project');
  });

  it('keeps missing Assets while loading a Project', async () => {
    const context = await createContext();
    const directory = await createTemporaryDirectory();
    const missingPath = join(directory, 'missing.pdf');
    addProject(context, 'project');
    insertAsset(context, {
      id: 'missing',
      projectId: 'project',
      path: missingPath,
    });
    const database = createAssetDatabase(context, {
      locatorChecker: new DefaultLocalFileLocatorChecker({
        now: () => new Date('2026-07-24T02:00:00.000Z'),
      }),
    });

    await database.loadFromProject('project');

    expect(database.get('missing')?.contentLocator).toMatchObject({
      path: missingPath,
      availability: 'missing',
    });
  });

  it('adds Assets to the active Project with derived metadata', async () => {
    const context = await createContext();
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, 'attention.v2.PDF');
    await writeFile(filePath, 'PDF');
    addProject(context, 'project');
    const database = createAssetDatabase(context, {
      createId: () => 'created-asset',
      now: () => new Date('2026-07-24T03:00:00.000Z'),
      locatorChecker: new DefaultLocalFileLocatorChecker({
        now: () => new Date('2026-07-24T02:00:00.000Z'),
      }),
    });
    await database.loadFromProject('project');

    const created = await database.add({ path: filePath });

    expect(created).toMatchObject({
      id: 'created-asset',
      projectId: 'project',
      name: 'attention.v2',
      mediaType: 'application/pdf',
      contentLocator: {
        kind: 'local-file',
        path: filePath,
        availability: 'available',
      },
      createdTime: new Date('2026-07-24T03:00:00.000Z'),
      lastUsedTime: new Date('2026-07-24T03:00:00.000Z'),
    });
    expect(context.db.select().from(assets).all()).toEqual([
      {
        id: 'created-asset',
        projectId: 'project',
        name: 'attention.v2',
        mediaType: 'application/pdf',
        contentKind: 'local-file',
        contentPath: filePath,
        createdTime: new Date('2026-07-24T03:00:00.000Z'),
        lastUsedTime: new Date('2026-07-24T03:00:00.000Z'),
      },
    ]);
  });

  it('writes update and delete through to SQLite', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/tmp/notes.md',
      name: '旧标题',
    });
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(),
    });
    await database.loadFromProject('project');

    const updated = database.update('asset', {
      name: '新标题',
      lastUsedTime: new Date('2026-07-24T04:00:00.000Z'),
    });

    expect(updated).toMatchObject({
      name: '新标题',
      lastUsedTime: new Date('2026-07-24T04:00:00.000Z'),
    });
    expect(context.db.select().from(assets).get()).toMatchObject({
      name: '新标题',
      lastUsedTime: new Date('2026-07-24T04:00:00.000Z'),
    });

    database.delete('asset');

    expect(database.list()).toEqual([]);
    expect(context.db.select().from(assets).all()).toEqual([]);
  });

  it('refreshes runtime availability without changing SQLite', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/tmp/notes.md',
    });
    let availability: LocalFileAvailability = 'available';
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(() => availability),
    });
    await database.loadFromProject('project');
    availability = 'missing';

    const refreshed = await database.refreshAvailability('asset');

    expect(refreshed.contentLocator.availability).toBe('missing');
    expect(context.db.select().from(assets).get()).not.toHaveProperty(
      'availability',
    );
  });

  it('relinks an Asset path while preserving all other persisted fields', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/old/notes.md',
      name: '自定义标题',
    });
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(),
    });
    await database.loadFromProject('project');

    const relinked = await database.relink('asset', '/new/notes.markdown');

    expect(relinked).toMatchObject({
      id: 'asset',
      projectId: 'project',
      name: '自定义标题',
      mediaType: 'text/markdown',
      contentLocator: {
        path: '/new/notes.markdown',
        availability: 'available',
      },
      createdTime: new Date('2026-07-24T01:00:00.000Z'),
      lastUsedTime: new Date('2026-07-24T01:00:00.000Z'),
    });
    expect(context.db.select().from(assets).get()).toEqual({
      id: 'asset',
      projectId: 'project',
      name: '自定义标题',
      mediaType: 'text/markdown',
      contentKind: 'local-file',
      contentPath: '/new/notes.markdown',
      createdTime: new Date('2026-07-24T01:00:00.000Z'),
      lastUsedTime: new Date('2026-07-24T01:00:00.000Z'),
    });

    relinked.createdTime.setTime(0);
    relinked.contentLocator.checkedTime.setTime(0);
    expect(database.get('asset')).toMatchObject({
      name: '自定义标题',
      createdTime: new Date('2026-07-24T01:00:00.000Z'),
      contentLocator: {
        checkedTime: new Date('2026-07-24T02:00:00.000Z'),
      },
    });
  });

  it('rejects unavailable and incompatible Relink targets atomically', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/old/notes.md',
    });
    let availability: LocalFileAvailability = 'missing';
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(() => availability),
    });
    await database.loadFromProject('project');

    await expect(database.relink('asset', '/new/notes.md')).rejects.toThrow(
      '无法重新定位到不可用的本地文件：missing',
    );
    availability = 'available';
    await expect(database.relink('asset', '/new/book.pdf')).rejects.toThrow(
      '重新定位的文件类型与原 Asset 不一致',
    );

    expect(database.get('asset')?.contentLocator.path).toBe('/old/notes.md');
    expect(context.db.select().from(assets).get()?.contentPath).toBe(
      '/old/notes.md',
    );
  });

  it('relinks unknown media only when final extensions match', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/old/report.docx',
      mediaType: 'application/octet-stream',
    });
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(),
    });
    await database.loadFromProject('project');

    await database.relink('asset', '/new/report.DOCX');
    await expect(database.relink('asset', '/new/report.xlsx')).rejects.toThrow(
      '重新定位的文件类型与原 Asset 不一致',
    );

    expect(database.get('asset')).toMatchObject({
      mediaType: 'application/octet-stream',
      contentLocator: { path: '/new/report.DOCX' },
    });
  });

  it('refreshes a normalized identical Relink path without writing SQLite', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/tmp/notes.md',
    });
    let availability: LocalFileAvailability = 'available';
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(() => availability),
    });
    await database.loadFromProject('project');
    availability = 'missing';
    context.sqlite.exec('DROP TABLE assets');

    const refreshed = await database.relink('asset', '/tmp/folder/../notes.md');

    expect(refreshed.contentLocator).toMatchObject({
      path: '/tmp/notes.md',
      availability: 'missing',
    });
  });

  it('keeps the old Relink Map value when the SQLite write fails', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/old/notes.md',
    });
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(),
    });
    await database.loadFromProject('project');
    context.sqlite.exec('DROP TABLE assets');

    await expect(database.relink('asset', '/new/notes.md')).rejects.toThrow();
    expect(database.get('asset')?.contentLocator.path).toBe('/old/notes.md');
  });

  it('does not write a Relink result after its Project unloads', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/old/notes.md',
    });
    let finishRelink: (() => void) | undefined;
    let checkingRelink = false;
    const database = createAssetDatabase(context, {
      locatorChecker: {
        check: async (path) => {
          if (checkingRelink) {
            await new Promise<void>((resolve) => {
              finishRelink = resolve;
            });
          }

          return createLocalFileContentLocator({
            path,
            availability: 'available',
            checkedTime: new Date('2026-07-24T02:00:00.000Z'),
          });
        },
      },
    });
    await database.loadFromProject('project');
    checkingRelink = true;

    const relink = database.relink('asset', '/new/notes.md');
    database.unloadProject();
    finishRelink?.();

    await expect(relink).rejects.toThrow('AssetDatabase 当前 Project 已变化');
    expect(context.db.select().from(assets).get()?.contentPath).toBe(
      '/old/notes.md',
    );
  });

  it('does not expose Asset, Locator or Date references', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/tmp/notes.md',
    });
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(),
    });
    await database.loadFromProject('project');
    const asset = database.get('asset');

    asset?.createdTime.setTime(0);
    asset?.contentLocator.checkedTime.setTime(0);
    database.list()[0]?.lastUsedTime.setTime(0);

    expect(database.get('asset')).toMatchObject({
      createdTime: new Date('2026-07-24T01:00:00.000Z'),
      lastUsedTime: new Date('2026-07-24T01:00:00.000Z'),
      contentLocator: {
        checkedTime: new Date('2026-07-24T02:00:00.000Z'),
      },
    });
  });

  it('preserves the current Map when loading another Project fails', async () => {
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
      path: '/tmp/fail.md',
    });
    const database = createAssetDatabase(context, {
      locatorChecker: {
        check: async (path) => {
          if (path.endsWith('fail.md')) {
            throw new Error('checker failed');
          }

          return createLocalFileContentLocator({
            path,
            availability: 'available',
            checkedTime: new Date('2026-07-24T02:00:00.000Z'),
          });
        },
      },
    });
    await database.loadFromProject('project-a');

    await expect(database.loadFromProject('project-b')).rejects.toThrow(
      'checker failed',
    );
    expect(database.getActiveProjectId()).toBe('project-a');
    expect(database.list().map(({ id }) => id)).toEqual(['asset-a']);
  });

  it('keeps the latest Project when concurrent loads finish out of order', async () => {
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
    let finishFirstLoad: (() => void) | undefined;
    const database = createAssetDatabase(context, {
      locatorChecker: {
        check: async (path) => {
          if (path.endsWith('a.md')) {
            await new Promise<void>((resolve) => {
              finishFirstLoad = resolve;
            });
          }

          return createLocalFileContentLocator({
            path,
            availability: 'available',
            checkedTime: new Date('2026-07-24T02:00:00.000Z'),
          });
        },
      },
    });

    const firstLoad = database.loadFromProject('project-a');
    await database.loadFromProject('project-b');
    finishFirstLoad?.();

    await expect(firstLoad).rejects.toThrow(
      'AssetDatabase Project 加载已被替代',
    );
    expect(database.getActiveProjectId()).toBe('project-b');
    expect(database.list().map(({ id }) => id)).toEqual(['asset-b']);
  });

  it('does not restore an Asset after its Project unloads during a refresh', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/tmp/notes.md',
    });
    let finishRefresh:
      ((availability: LocalFileAvailability) => void) | undefined;
    let checkingRefresh = false;
    const database = createAssetDatabase(context, {
      locatorChecker: {
        check: async (path) => {
          if (!checkingRefresh) {
            return createLocalFileContentLocator({
              path,
              availability: 'available',
              checkedTime: new Date('2026-07-24T02:00:00.000Z'),
            });
          }

          const availability = await new Promise<LocalFileAvailability>(
            (resolve) => {
              finishRefresh = resolve;
            },
          );
          return createLocalFileContentLocator({
            path,
            availability,
            checkedTime: new Date('2026-07-24T03:00:00.000Z'),
          });
        },
      },
    });
    await database.loadFromProject('project');
    checkingRefresh = true;

    const refresh = database.refreshAvailability('asset');
    database.unloadProject();
    finishRefresh?.('missing');

    await expect(refresh).rejects.toThrow('AssetDatabase 当前 Project 已变化');
    expect(database.getActiveProjectId()).toBeUndefined();
    expect(() => database.list()).toThrow('AssetDatabase 尚未加载 Project');
  });

  it('keeps the previous Map value when a database write fails', async () => {
    const context = await createContext();
    addProject(context, 'project');
    insertAsset(context, {
      id: 'asset',
      projectId: 'project',
      path: '/tmp/notes.md',
      name: '旧标题',
    });
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(),
    });
    await database.loadFromProject('project');
    context.sqlite.exec('DROP TABLE assets');

    expect(() => database.update('asset', { name: '新标题' })).toThrow();
    expect(database.get('asset')?.name).toBe('旧标题');
  });

  it('rejects unknown Projects, unavailable additions and invalid mutations', async () => {
    const context = await createContext();
    addProject(context, 'project');
    let availability: LocalFileAvailability = 'missing';
    const database = createAssetDatabase(context, {
      locatorChecker: createFixedChecker(() => availability),
    });

    await expect(database.loadFromProject('missing')).rejects.toThrow(
      '找不到指定的 Project',
    );
    await database.loadFromProject('project');
    await expect(database.add({ path: '/tmp/missing.md' })).rejects.toThrow(
      '无法添加不可用的本地文件：missing',
    );

    expect(() => database.update('missing', {})).toThrow('Asset 更新内容无效');
    expect(() =>
      database.update('missing', { projectId: 'other' } as never),
    ).toThrow('Asset 更新内容无效');
    expect(() => database.update('missing', { name: '新标题' })).toThrow(
      '找不到当前 Project 中指定的 Asset',
    );
    expect(() => database.delete('missing')).toThrow(
      '找不到当前 Project 中指定的 Asset',
    );

    availability = 'available';
    expect(context.db.select().from(assets).all()).toEqual([]);
  });
});
