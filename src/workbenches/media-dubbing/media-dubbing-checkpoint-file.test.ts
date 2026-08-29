import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  loadMediaDubbingCheckpoint,
  markMediaDubbingCheckpointPrepared,
  openMediaDubbingCheckpoint,
  removeMediaDubbingCheckpoint,
  type MediaDubbingCheckpointIdentity,
} from './media-dubbing-checkpoint-file';

const temporaryDirectories: string[] = [];

async function createIdentity(): Promise<MediaDubbingCheckpointIdentity> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'lc-dubbing-checkpoint-'));
  temporaryDirectories.push(workspacePath);
  return {
    workspacePath,
    assetId: 'asset-1',
    sourceRevision: 'source-revision',
    producerVersion: '1',
    phrasePlannerVersion: 2,
    phrasesRevision: 'phrases-revision',
    totalPhrases: 3,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('media dubbing checkpoint file', () => {
  it('restores a prepared checkpoint for the exact dubbing input', async () => {
    const identity = await createIdentity();
    const created = await openMediaDubbingCheckpoint(identity);
    expect(created.manifest).toBeUndefined();
    await Promise.all([
      writeFile(created.paths.backgroundPath, 'background'),
      writeFile(created.paths.referencePath, 'reference'),
    ]);
    await markMediaDubbingCheckpointPrepared(created.paths, identity, 12_000);

    const restored = await openMediaDubbingCheckpoint(identity);

    expect(restored.paths).toEqual(created.paths);
    expect(restored.manifest).toEqual({ durationMs: 12_000 });
  });

  it('inspects only an exact prepared checkpoint without creating state', async () => {
    const identity = await createIdentity();
    await expect(loadMediaDubbingCheckpoint(identity)).resolves.toBeUndefined();
    const created = await openMediaDubbingCheckpoint(identity);
    await Promise.all([
      writeFile(created.paths.backgroundPath, 'background'),
      writeFile(created.paths.referencePath, 'reference'),
    ]);
    await markMediaDubbingCheckpointPrepared(created.paths, identity, 12_000);

    const restored = await loadMediaDubbingCheckpoint(identity);

    expect(restored).toEqual({
      paths: created.paths,
      manifest: { durationMs: 12_000 },
    });
    await expect(
      loadMediaDubbingCheckpoint({ ...identity, producerVersion: '2' }),
    ).resolves.toBeUndefined();
    await expect(access(created.paths.manifestPath)).resolves.toBeUndefined();
  });

  it('discards partial files when the producer contract changes', async () => {
    const identity = await createIdentity();
    const created = await openMediaDubbingCheckpoint(identity);
    await Promise.all([
      writeFile(created.paths.backgroundPath, 'background'),
      writeFile(created.paths.referencePath, 'reference'),
      writeFile(created.paths.progressPath, '{"completedPhrases":2}'),
    ]);
    await markMediaDubbingCheckpointPrepared(created.paths, identity, 12_000);

    const reset = await openMediaDubbingCheckpoint({
      ...identity,
      producerVersion: '2',
    });

    expect(reset.manifest).toBeUndefined();
    await expect(access(reset.paths.progressPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('removes a completed checkpoint without touching the workspace', async () => {
    const identity = await createIdentity();
    const checkpoint = await openMediaDubbingCheckpoint(identity);
    await writeFile(checkpoint.paths.progressPath, 'partial');

    await removeMediaDubbingCheckpoint(identity);

    await expect(access(checkpoint.paths.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(identity.workspacePath)).resolves.toBeUndefined();
  });
});
