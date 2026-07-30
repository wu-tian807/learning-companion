import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createAbsoluteLocalFileContentRef,
} from '../../shared/assets';
import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { assetArtifacts } from '../database/schema/asset-artifacts';
import { assets } from '../database/schema/assets';
import { projects } from '../database/schema/projects';
import {
  AssetArtifactDatabase,
} from './asset-artifact-database';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createContext(): Promise<DatabaseContext> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-artifact-db-'),
  );
  temporaryDirectories.push(directory);
  const context = initializeDatabase(join(directory, 'database.sqlite3'));
  contexts.push(context);
  context.db
    .insert(projects)
    .values({
      id: 'project',
      name: 'Project',
      icon: '📘',
      workspacePath: join(directory, 'workspace'),
      createdTime: Date.parse('2026-07-30T01:00:00.000Z'),
      pinned: false,
    })
    .run();
  context.db
    .insert(assets)
    .values({
      id: 'asset',
      projectId: 'project',
      name: '课程',
      mediaType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      contentRef: createAbsoluteLocalFileContentRef(
        join(directory, 'course.docx'),
      ),
      createdTime: Date.parse('2026-07-30T01:00:00.000Z'),
      lastUsedTime: Date.parse('2026-07-30T01:00:00.000Z'),
    })
    .run();
  return context;
}

function createArtifact(overrides: Record<string, unknown> = {}) {
  return {
    assetId: 'asset',
    producerId: 'builtin.office.preview',
    artifactKey: 'preview',
    relativePath:
      '.learning-companion/artifacts/asset/builtin.office.preview/a.pdf',
    mediaType: 'application/pdf',
    sourceRevision: 'source-a',
    producerVersion: 'producer-a',
    artifactRevision: 'artifact-a',
    updatedTime: Date.parse('2026-07-30T02:00:00.000Z'),
    ...overrides,
  };
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

describe('AssetArtifactDatabase', () => {
  it('upserts, gets, lists and deletes Artifact records', async () => {
    const context = await createContext();
    const database = new AssetArtifactDatabase(context);
    const created = database.upsert(createArtifact());
    const updated = database.upsert(
      createArtifact({
        relativePath:
          '.learning-companion/artifacts/asset/builtin.office.preview/b.pdf',
        sourceRevision: 'source-b',
        artifactRevision: 'artifact-b',
        updatedTime: Date.parse('2026-07-30T03:00:00.000Z'),
      }),
    );

    expect(created).not.toBe(updated);
    expect(
      database.get({
        assetId: 'asset',
        producerId: 'builtin.office.preview',
        artifactKey: 'preview',
      }),
    ).toEqual(updated);
    expect(database.listByAsset('asset')).toEqual([updated]);
    expect(database.listByProject('project')).toEqual([updated]);
    expect(context.db.select().from(assetArtifacts).all()).toHaveLength(1);

    database.deleteByAsset('asset');

    expect(database.listByAsset('asset')).toEqual([]);
  });

  it('deletes only Artifact records that belong to the selected Project', async () => {
    const context = await createContext();
    const database = new AssetArtifactDatabase(context);
    context.db
      .insert(projects)
      .values({
        id: 'another-project',
        name: 'Another Project',
        icon: '📗',
        workspacePath: '/tmp/another-project',
        createdTime: 1,
        pinned: false,
      })
      .run();
    context.db
      .insert(assets)
      .values({
        id: 'another-asset',
        projectId: 'another-project',
        name: 'Another Asset',
        mediaType: 'application/pdf',
        contentRef: createAbsoluteLocalFileContentRef('/tmp/book.pdf'),
        createdTime: 1,
        lastUsedTime: 1,
      })
      .run();
    const current = database.upsert(createArtifact());
    const another = database.upsert(
      createArtifact({
        assetId: 'another-asset',
        relativePath:
          '.learning-companion/artifacts/another-asset/builtin.office.preview/b.pdf',
      }),
    );

    expect(database.listByProject('project')).toEqual([current]);
    expect(database.listByProject('another-project')).toEqual([another]);

    database.deleteByProject('project');

    expect(database.listByProject('project')).toEqual([]);
    expect(database.listByProject('another-project')).toEqual([another]);
  });

  it('maps invalid persisted data to a data integrity error', async () => {
    const context = await createContext();
    context.sqlite.pragma('ignore_check_constraints = ON');
    context.sqlite
      .prepare(
        `INSERT INTO asset_artifacts (
          asset_id, producer_id, artifact_key, relative_path, media_type,
          source_revision, producer_version, artifact_revision, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'asset',
        'builtin.office.preview',
        'preview',
        '../escaped.pdf',
        'application/pdf',
        'source',
        'producer',
        'artifact',
        1,
      );
    context.sqlite.pragma('ignore_check_constraints = OFF');
    const database = new AssetArtifactDatabase(context);

    expect(() => database.listByAsset('asset')).toThrow(
      'DATA_INTEGRITY_ERROR',
    );
  });

  it('rejects invalid records before writing', async () => {
    const context = await createContext();
    const database = new AssetArtifactDatabase(context);

    expect(() =>
      database.upsert(createArtifact({ mediaType: 'pdf' }) as never),
    ).toThrow('DATA_INTEGRITY_ERROR');
    expect(context.db.select().from(assetArtifacts).all()).toEqual([]);
  });
});
