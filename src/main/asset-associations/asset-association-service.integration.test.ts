import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAbsoluteLocalFileContentRef } from '../../shared/assets';
import { AssetDatabase } from '../assets/asset-database';
import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { assets } from '../database/schema/assets';
import { projects } from '../database/schema/projects';
import { ProjectDatabase } from '../projects/project-database';
import { AssetAssociationService } from './asset-association-service';
import { AssetLinkDatabase } from './asset-link-database';
import { AssetReferenceDatabase } from './asset-reference-database';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createContext(): Promise<DatabaseContext> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-association-integration-'),
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
  projectId: string,
  id: string,
): void {
  context.db
    .insert(assets)
    .values({
      id,
      projectId,
      name: id,
      mediaType: 'text/plain',
      creationKind: 'imported',
      contentRef: createAbsoluteLocalFileContentRef(`/tmp/${id}.txt`),
      createdTime: 1,
      updatedTime: 1,
    })
    .run();
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

describe('AssetAssociationService SQLite integration', () => {
  it('loads, switches, mutates, cascades, and unloads by Project', async () => {
    const context = await createContext();
    addProject(context, 'project-a');
    addProject(context, 'project-b');
    addAsset(context, 'project-a', 'map-a');
    addAsset(context, 'project-a', 'pdf-a');
    addAsset(context, 'project-a', 'lecture-a');
    addAsset(context, 'project-b', 'map-b');
    addAsset(context, 'project-b', 'pdf-b');
    const projectDatabase = new ProjectDatabase(context);
    projectDatabase.initialize();
    const assetDatabase = new AssetDatabase(context);
    let referenceId = 0;
    const referenceDatabase = new AssetReferenceDatabase(context, {
      createId: () => `reference-${++referenceId}`,
      now: () => referenceId,
    });
    let linkId = 0;
    const linkDatabase = new AssetLinkDatabase(context, {
      createId: () => `link-${++linkId}`,
      now: () => linkId,
    });
    referenceDatabase.create('project-a', 'map-a', {
      sourceAssetId: 'pdf-a',
    });
    linkDatabase.create('project-a', 'map-a', {
      targetAssetId: 'lecture-a',
    });
    referenceDatabase.create('project-b', 'map-b', {
      sourceAssetId: 'pdf-b',
    });
    const service = new AssetAssociationService(
      referenceDatabase,
      linkDatabase,
      projectDatabase,
      assetDatabase,
    );

    service.loadFromProject('project-a');
    expect(service.listReferences('map-a').map(({ id }) => id)).toEqual([
      'reference-1',
    ]);
    expect(service.listLinks('map-a').map(({ id }) => id)).toEqual([
      'link-1',
    ]);

    service.loadFromProject('project-b');
    expect(service.getReference('reference-1')).toBeUndefined();
    expect(service.listReferences('map-b').map(({ id }) => id)).toEqual([
      'reference-2',
    ]);
    expect(() => service.listReferences('map-a')).toThrow('ASSET_NOT_FOUND');

    assetDatabase.delete('project-b', 'pdf-b');
    service.onAssetDeleted('project-b', 'pdf-b');
    expect(service.listReferences('map-b')).toEqual([]);
    expect(referenceDatabase.listByProject('project-b')).toEqual([]);

    service.unloadProject();
    expect(service.getActiveProjectId()).toBeUndefined();
    expect(() => service.listLinks('map-b')).toThrow('SERVICE_NOT_READY');
  });
});
