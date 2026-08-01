import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createAbsoluteLocalFileContentRef } from '../../shared/assets';
import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { assetLinks } from '../database/schema/asset-links';
import { assets } from '../database/schema/assets';
import { projects } from '../database/schema/projects';
import {
  AssetLinkDatabase,
  type AssetLinkDatabaseDependencies,
} from './asset-link-database';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createContext(): Promise<DatabaseContext> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-asset-link-db-'),
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
      createdTime: 1_785_513_600_000,
      pinned: false,
      workspacePath: `/tmp/projects/${id}`,
    })
    .run();
}

function addAsset(
  context: DatabaseContext,
  projectId: string,
  id: string,
): void {
  context.db
    .insert(assets)
    .values({
      id,
      projectId,
      name: id,
      mediaType: 'text/markdown',
      creationKind: 'imported',
      contentRef: createAbsoluteLocalFileContentRef(`/tmp/${id}.md`),
      createdTime: 1_785_513_600_000,
      updatedTime: 1_785_513_600_000,
    })
    .run();
}

function createDatabase(
  context: DatabaseContext,
  dependencies: Partial<AssetLinkDatabaseDependencies> = {},
): AssetLinkDatabase {
  return new AssetLinkDatabase(context, dependencies);
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

describe('AssetLinkDatabase', () => {
  it('persists and lists directed Asset-level links', async () => {
    const context = await createContext();
    addProject(context, 'project');
    addAsset(context, 'project', 'mindmap');
    addAsset(context, 'project', 'lecture');
    const database = createDatabase(context, {
      createId: () => 'link',
      now: () => 1_785_513_600_123,
    });
    const created = database.create('project', 'mindmap', {
      targetAssetId: 'lecture',
    });

    expect(created).toEqual({
      id: 'link',
      projectId: 'project',
      assetId: 'mindmap',
      targetAssetId: 'lecture',
      createdTime: 1_785_513_600_123,
    });
    expect(database.listByProject('project')).toEqual([created]);
    expect(database.listByAsset('project', 'mindmap')).toEqual([created]);
    expect(database.listByAsset('project', 'lecture')).toEqual([]);
  });

  it('enforces Project boundaries, non-self links, and unique pairs', async () => {
    const context = await createContext();
    addProject(context, 'project-a');
    addProject(context, 'project-b');
    addAsset(context, 'project-a', 'mindmap');
    addAsset(context, 'project-a', 'lecture');
    addAsset(context, 'project-b', 'other-lecture');
    let id = 0;
    const database = createDatabase(context, {
      createId: () => `link-${++id}`,
    });

    expect(() =>
      database.create('project-a', 'mindmap', {
        targetAssetId: 'other-lecture',
      }),
    ).toThrow('invalid AssetLink');
    expect(() =>
      database.create('project-a', 'mindmap', {
        targetAssetId: 'mindmap',
      }),
    ).toThrow('AssetLink 数据无效');

    database.create('project-a', 'mindmap', {
      targetAssetId: 'lecture',
    });
    expect(() =>
      database.create('project-a', 'mindmap', {
        targetAssetId: 'lecture',
      }),
    ).toThrow();
  });

  it('cascades links when the owner or target Asset is deleted', async () => {
    const context = await createContext();
    addProject(context, 'project');
    addAsset(context, 'project', 'mindmap');
    addAsset(context, 'project', 'lecture');
    const database = createDatabase(context, { createId: () => 'link' });
    database.create('project', 'mindmap', { targetAssetId: 'lecture' });

    context.db.delete(assets).where(eq(assets.id, 'lecture')).run();

    expect(database.listByAsset('project', 'mindmap')).toEqual([]);
  });

  it('deletes links only in the requested Project', async () => {
    const context = await createContext();
    addProject(context, 'project');
    addAsset(context, 'project', 'mindmap');
    addAsset(context, 'project', 'lecture');
    const database = createDatabase(context, { createId: () => 'link' });
    database.create('project', 'mindmap', { targetAssetId: 'lecture' });

    expect(() => database.delete('other-project', 'link')).toThrow(
      'DATABASE_WRITE_CONFLICT',
    );
    database.delete('project', 'link');
    expect(context.db.select().from(assetLinks).all()).toEqual([]);
  });
});
