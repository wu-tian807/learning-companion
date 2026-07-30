import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createAbsoluteLocalFileContentRef,
} from '../../shared/assets';
import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { assets } from '../database/schema/assets';
import { projects } from '../database/schema/projects';
import { AssetArtifactDatabase } from './asset-artifact-database';
import {
  ASSET_ARTIFACT_STAGING_DIRECTORY,
  AssetArtifactFileManager,
} from './asset-artifact-file-manager';
import {
  AssetArtifactRegistry,
  type AssetArtifactProducer,
} from './asset-artifact-registry';
import {
  AssetArtifactService,
  type AssetArtifactRequest,
} from './asset-artifact-service';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

interface Harness {
  readonly context: DatabaseContext;
  readonly workspacePath: string;
  readonly sourcePath: string;
  readonly database: AssetArtifactDatabase;
  readonly registry: AssetArtifactRegistry;
  readonly service: AssetArtifactService;
}

async function createHarness(
  producer: AssetArtifactProducer,
): Promise<Harness> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-artifact-service-'),
  );
  temporaryDirectories.push(directory);
  const workspacePath = join(directory, 'workspace');
  const sourcePath = join(directory, 'course.docx');
  await writeFile(sourcePath, 'office-source');
  await mkdir(workspacePath, { recursive: true });
  const context = initializeDatabase(join(directory, 'database.sqlite3'));
  contexts.push(context);
  context.db
    .insert(projects)
    .values({
      id: 'project',
      name: 'Project',
      icon: '📘',
      workspacePath,
      createdTime: 1,
      pinned: false,
    })
    .run();
  context.db
    .insert(assets)
    .values({
      id: 'asset',
      projectId: 'project',
      name: '课程',
      mediaType: producer.id,
      contentRef: createAbsoluteLocalFileContentRef(sourcePath),
      createdTime: 1,
      lastUsedTime: 1,
    })
    .run();
  const database = new AssetArtifactDatabase(context);
  const registry = new AssetArtifactRegistry();
  registry.register(producer);
  const service = new AssetArtifactService(
    database,
    new AssetArtifactFileManager(),
    registry,
    {
      now: () => 2,
      logger: { warn: vi.fn() },
    },
  );

  return {
    context,
    workspacePath,
    sourcePath,
    database,
    registry,
    service,
  };
}

function createRequest(
  harness: Harness,
  revision = 'source-a',
): AssetArtifactRequest {
  return {
    assetId: 'asset',
    producerId: 'builtin.office.preview',
    artifactKey: 'preview',
    workspacePath: harness.workspacePath,
    source: {
      assetId: 'asset',
      mediaType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      absolutePath: harness.sourcePath,
      revision,
    },
  };
}

function createProducer(
  produce: AssetArtifactProducer['produce'],
): AssetArtifactProducer {
  return {
    id: 'builtin.office.preview',
    version: 'office-preview@1+libreoffice@test',
    produce,
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

describe('AssetArtifactService', () => {
  it('generates once, reuses valid cache and replaces stale revisions', async () => {
    const produce = vi.fn<AssetArtifactProducer['produce']>(
      async (request) => {
        const filePath = join(request.stagingDirectory, 'preview.pdf');
        await writeFile(filePath, `%PDF-1.7\n${request.source.revision}`);
        return {
          filePath,
          mediaType: 'application/pdf',
          extension: 'pdf',
        };
      },
    );
    const harness = await createHarness(createProducer(produce));

    const first = await harness.service.getOrCreate(
      createRequest(harness),
    );
    const cached = await harness.service.getOrCreate(
      createRequest(harness),
    );
    const updated = await harness.service.getOrCreate(
      createRequest(harness, 'source-b'),
    );

    expect(first.cacheHit).toBe(false);
    expect(cached).toMatchObject({
      artifact: first.artifact,
      absolutePath: first.absolutePath,
      cacheHit: true,
    });
    expect(updated.cacheHit).toBe(false);
    expect(updated.absolutePath).not.toBe(first.absolutePath);
    expect(produce).toHaveBeenCalledTimes(2);
    await expect(access(first.absolutePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(harness.database.listByAsset('asset')).toEqual([
      updated.artifact,
    ]);
  });

  it('deduplicates concurrent generation for the same stable key', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const produce = vi.fn<AssetArtifactProducer['produce']>(
      async (request) => {
        await gate;
        const filePath = join(request.stagingDirectory, 'preview.pdf');
        await writeFile(filePath, '%PDF-1.7\nconcurrent');
        return {
          filePath,
          mediaType: 'application/pdf',
          extension: 'pdf',
        };
      },
    );
    const harness = await createHarness(createProducer(produce));
    const request = createRequest(harness);

    const first = harness.service.getOrCreate(request);
    const second = harness.service.getOrCreate(request);
    await vi.waitFor(() => {
      expect(produce).toHaveBeenCalledTimes(1);
    });
    release!();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('does not publish an index when Producer generation fails', async () => {
    const harness = await createHarness(
      createProducer(async () => {
        throw new Error('conversion failed');
      }),
    );

    await expect(
      harness.service.getOrCreate(createRequest(harness)),
    ).rejects.toThrow('conversion failed');

    expect(harness.database.listByAsset('asset')).toEqual([]);
    await expect(
      readdir(
        join(
          harness.workspacePath,
          ...ASSET_ARTIFACT_STAGING_DIRECTORY.split('/'),
        ),
      ),
    ).resolves.toEqual([]);
  });

  it('rejects Producer output outside its staging directory', async () => {
    const harness = await createHarness(
      createProducer(async (request) => ({
        filePath: request.source.absolutePath,
        mediaType: 'application/pdf',
        extension: 'pdf',
      })),
    );

    await expect(
      harness.service.getOrCreate(createRequest(harness)),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    expect(harness.database.listByAsset('asset')).toEqual([]);
  });
});
