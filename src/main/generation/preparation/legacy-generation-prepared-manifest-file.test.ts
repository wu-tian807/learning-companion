import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GenerationTask } from '../generation-task';
import { LegacyGenerationPreparedManifestFile } from './legacy-generation-prepared-manifest-file';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createTask() {
  return GenerationTask.create({
    id: 'task-1',
    projectId: 'project-1',
    definitionId: 'mindmap.generate',
    definitionVersion: 1,
    instruction: { format: 'test', version: 1 },
    assetReferences: { sources: [{ assetId: 'asset-1' }] },
    createdTime: 1,
  });
}

describe('LegacyGenerationPreparedManifestFile', () => {
  it('reads a v20 manifest only for unfinished-task compatibility', async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), 'generation-legacy-manifest-'),
    );
    temporaryDirectories.push(workspace);
    const manifestRef =
      'control/tasks/task-1/prepared-manifest.json';
    const manifestPath = join(workspace, ...manifestRef.split('/'));
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        format: 'learning-companion/generation-prepared-manifest',
        version: 1,
        taskId: 'task-1',
        projectId: 'project-1',
        definitionId: 'mindmap.generate',
        definitionVersion: 1,
        assetReferences: {
          sources: [
            {
              alias: 'sources-0001',
              assetId: 'asset-1',
              name: 'lesson.pdf',
              mediaType: 'application/pdf',
              contentRevision: 'revision-1',
              relativePath: 'references/sources-0001/source.pdf',
            },
          ],
        },
      }),
      'utf8',
    );

    const references = await new LegacyGenerationPreparedManifestFile().read(
      workspace,
      manifestRef,
      createTask().getSnapshot(),
    );

    expect(references.sources?.[0]?.assetId).toBe('asset-1');
  });

  it('rejects a manifest belonging to another task', async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), 'generation-legacy-manifest-invalid-'),
    );
    temporaryDirectories.push(workspace);
    const manifestRef = 'control/prepared-manifest.json';
    const manifestPath = join(workspace, ...manifestRef.split('/'));
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        format: 'learning-companion/generation-prepared-manifest',
        version: 1,
        taskId: 'other-task',
        projectId: 'project-1',
        definitionId: 'mindmap.generate',
        definitionVersion: 1,
        assetReferences: {},
      }),
      'utf8',
    );

    await expect(
      new LegacyGenerationPreparedManifestFile().read(
        workspace,
        manifestRef,
        createTask().getSnapshot(),
      ),
    ).rejects.toThrow('Legacy Generation prepared manifest 数据无效');
  });
});
