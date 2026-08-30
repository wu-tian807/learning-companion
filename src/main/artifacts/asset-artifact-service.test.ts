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
      creationKind: 'imported',
      contentRef: createAbsoluteLocalFileContentRef(sourcePath),
      createdTime: 1,
      updatedTime: 1,
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

    await expect(
      harness.service.getCached(createRequest(harness)),
    ).resolves.toBeUndefined();
    const first = await harness.service.getOrCreate(
      createRequest(harness),
    );
    await expect(
      harness.service.getCached(createRequest(harness)),
    ).resolves.toMatchObject({
      artifact: first.artifact,
      absolutePath: first.absolutePath,
      cacheHit: true,
    });
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

  it('removes generated files and indexes with the Asset lifecycle', async () => {
    const harness = await createHarness(
      createProducer(async (request) => {
        const filePath = join(request.stagingDirectory, 'preview.pdf');
        await writeFile(filePath, '%PDF-1.7\ncleanup');
        return {
          filePath,
          mediaType: 'application/pdf',
          extension: 'pdf',
        };
      }),
    );
    const generated = await harness.service.getOrCreate(
      createRequest(harness),
    );

    await harness.service.removeByAsset('asset', harness.workspacePath);

    await expect(access(generated.absolutePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(harness.database.listByAsset('asset')).toEqual([]);
  });

  it('keeps the Artifact index when its managed file cannot be removed', async () => {
    const harness = await createHarness(
      createProducer(async (request) => {
        const filePath = join(request.stagingDirectory, 'preview.pdf');
        await writeFile(filePath, '%PDF-1.7\nlocked');
        return {
          filePath,
          mediaType: 'application/pdf',
          extension: 'pdf',
        };
      }),
    );
    const generated = await harness.service.getOrCreate(
      createRequest(harness),
    );
    const removeArtifactFile = vi
      .spyOn(AssetArtifactFileManager.prototype, 'removeArtifactFile')
      .mockRejectedValueOnce(new Error('artifact file locked'));

    try {
      await expect(
        harness.service.removeByAsset('asset', harness.workspacePath),
      ).rejects.toThrow('artifact file locked');
    } finally {
      removeArtifactFile.mockRestore();
    }

    await expect(access(generated.absolutePath)).resolves.toBeUndefined();
    expect(harness.database.listByAsset('asset')).toEqual([
      generated.artifact,
    ]);
  });

  it('cancels active generation before removing Project artifacts', async () => {
    let generationStarted: (() => void) | undefined;
    const started = new Promise<void>((resolvePromise) => {
      generationStarted = resolvePromise;
    });
    const harness = await createHarness(
      createProducer(async (_request, signal) => {
        generationStarted!();
        await new Promise<void>((_resolvePromise, rejectPromise) => {
          signal.addEventListener(
            'abort',
            () => rejectPromise(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        });
        throw new Error('unreachable');
      }),
    );
    const generation = harness.service.getOrCreate(createRequest(harness));
    await started;

    await harness.service.removeByProject(
      'project',
      harness.workspacePath,
    );

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.database.listByProject('project')).toEqual([]);
  });

  it('stops Project generation without deleting persisted artifacts', async () => {
    let generationStarted: (() => void) | undefined;
    const started = new Promise<void>((resolvePromise) => {
      generationStarted = resolvePromise;
    });
    const harness = await createHarness(
      createProducer(async (_request, signal) => {
        generationStarted!();
        await new Promise<void>((_resolvePromise, rejectPromise) => {
          signal.addEventListener(
            'abort',
            () => rejectPromise(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        });
        throw new Error('unreachable');
      }),
    );
    const persisted = harness.database.upsert({
      assetId: 'asset',
      producerId: 'builtin.office.preview',
      artifactKey: 'persisted-preview',
      relativePath: '.learning-companion/artifacts/persisted.pdf',
      mediaType: 'application/pdf',
      sourceRevision: 'persisted-source',
      producerVersion: '1',
      artifactRevision: 'persisted-artifact',
      updatedTime: 1,
    });
    const generation = harness.service.getOrCreate(createRequest(harness));
    await started;

    await harness.service.cancelByWorkspace(harness.workspacePath);

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.database.listByProject('project')).toEqual([persisted]);
  });
});
