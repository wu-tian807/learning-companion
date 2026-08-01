import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createAbsoluteLocalFileContentRef } from '../../shared/assets';
import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { assetReferences } from '../database/schema/asset-references';
import { assets } from '../database/schema/assets';
import { projects } from '../database/schema/projects';
import {
  AssetReferenceDatabase,
  type AssetReferenceDatabaseDependencies,
} from './asset-reference-database';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createContext(): Promise<DatabaseContext> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-asset-reference-db-'),
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
  dependencies: Partial<AssetReferenceDatabaseDependencies> = {},
): AssetReferenceDatabase {
  return new AssetReferenceDatabase(context, dependencies);
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

describe('AssetReferenceDatabase', () => {
  it('persists and lists simple Asset-level references', async () => {
    const context = await createContext();
    addProject(context, 'project');
    addAsset(context, 'project', 'mindmap');
    addAsset(context, 'project', 'pdf');
    const database = createDatabase(context, {
      createId: () => 'reference',
      now: () => 1_785_513_600_123,
    });
    const created = database.create('project', 'mindmap', {
      sourceAssetId: 'pdf',
    });

    expect(created).toEqual({
      id: 'reference',
      projectId: 'project',
      assetId: 'mindmap',
      sourceAssetId: 'pdf',
      createdTime: 1_785_513_600_123,
    });
    expect(database.listByProject('project')).toEqual([created]);
    expect(database.listByAsset('project', 'mindmap')).toEqual([created]);
    expect(database.listByAsset('project', 'pdf')).toEqual([]);
  });

  it('enforces Project boundaries, non-self references, and unique pairs', async () => {
    const context = await createContext();
    addProject(context, 'project-a');
    addProject(context, 'project-b');
    addAsset(context, 'project-a', 'mindmap');
    addAsset(context, 'project-a', 'pdf');
    addAsset(context, 'project-b', 'other-pdf');
    let id = 0;
    const database = createDatabase(context, {
      createId: () => `reference-${++id}`,
    });

    expect(() =>
      database.create('project-a', 'mindmap', {
        sourceAssetId: 'other-pdf',
      }),
    ).toThrow('invalid AssetReference');
    expect(() =>
      database.create('project-a', 'mindmap', {
        sourceAssetId: 'mindmap',
      }),
    ).toThrow('AssetReference 数据无效');

    database.create('project-a', 'mindmap', { sourceAssetId: 'pdf' });
    expect(() =>
      database.create('project-a', 'mindmap', { sourceAssetId: 'pdf' }),
    ).toThrow();
  });

  it('cascades references when the owner or source Asset is deleted', async () => {
    const context = await createContext();
    addProject(context, 'project');
    addAsset(context, 'project', 'mindmap');
    addAsset(context, 'project', 'pdf');
    const database = createDatabase(context, {
      createId: () => 'reference',
    });
    database.create('project', 'mindmap', { sourceAssetId: 'pdf' });

    context.db.delete(assets).where(eq(assets.id, 'pdf')).run();

    expect(database.listByAsset('project', 'mindmap')).toEqual([]);
  });

  it('deletes references only in the requested Project', async () => {
    const context = await createContext();
    addProject(context, 'project');
    addAsset(context, 'project', 'mindmap');
    addAsset(context, 'project', 'pdf');
    const database = createDatabase(context, {
      createId: () => 'reference',
    });
    database.create('project', 'mindmap', { sourceAssetId: 'pdf' });

    expect(() => database.delete('other-project', 'reference')).toThrow(
      'DATABASE_WRITE_CONFLICT',
    );
    database.delete('project', 'reference');
    expect(context.db.select().from(assetReferences).all()).toEqual([]);
  });
});
