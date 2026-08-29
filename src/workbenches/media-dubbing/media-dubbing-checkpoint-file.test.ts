import { createHash } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  loadMediaDubbingCheckpoint,
  markMediaDubbingCheckpointPrepared,
  mediaDubbingReferencePath,
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
    phrasePlannerVersion: 3,
    speakerPlannerVersion: 1,
    inputRevision: 'input-revision',
  };
}

async function prepare(
  identity: MediaDubbingCheckpointIdentity,
): ReturnType<typeof openMediaDubbingCheckpoint> {
  const created = await openMediaDubbingCheckpoint(identity);
  const speakerPlan = '{"version":1}\n';
  await Promise.all([
    writeFile(created.paths.backgroundPath, 'background'),
    writeFile(created.paths.speakerPlanPath, speakerPlan),
    writeFile(
      mediaDubbingReferencePath(created.paths, 'speaker-0001'),
      'reference',
    ),
  ]);
  await markMediaDubbingCheckpointPrepared(created.paths, identity, {
    durationMs: 12_000,
    totalPhrases: 3,
    planRevision: createHash('sha256').update(speakerPlan).digest('hex'),
    referenceSpeakerIds: ['speaker-0001'],
  });
  return created;
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
    await prepare(identity);

    const restored = await openMediaDubbingCheckpoint(identity);

    expect(restored.paths).toEqual(created.paths);
    expect(restored.manifest).toEqual({
      durationMs: 12_000,
      totalPhrases: 3,
      planRevision: expect.stringMatching(/^[a-f0-9]{64}$/u),
      referenceSpeakerIds: ['speaker-0001'],
    });
  });

  it('inspects only an exact prepared checkpoint without creating state', async () => {
    const identity = await createIdentity();
    await expect(loadMediaDubbingCheckpoint(identity)).resolves.toBeUndefined();
    const created = await prepare(identity);

    const restored = await loadMediaDubbingCheckpoint(identity);

    expect(restored).toEqual({
      paths: created.paths,
      manifest: {
        durationMs: 12_000,
        totalPhrases: 3,
        planRevision: expect.stringMatching(/^[a-f0-9]{64}$/u),
        referenceSpeakerIds: ['speaker-0001'],
      },
    });
    await expect(
      loadMediaDubbingCheckpoint({ ...identity, producerVersion: '2' }),
    ).resolves.toBeUndefined();
    await expect(access(created.paths.manifestPath)).resolves.toBeUndefined();
  });

  it('discards partial files when the producer contract changes', async () => {
    const identity = await createIdentity();
    const created = await prepare(identity);
    await writeFile(created.paths.progressPath, '{"completedPhrases":2}');

    const reset = await openMediaDubbingCheckpoint({
      ...identity,
      producerVersion: '2',
    });

    expect(reset.manifest).toBeUndefined();
    await expect(access(reset.paths.progressPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('discards a checkpoint when its persisted speaker plan changes', async () => {
    const identity = await createIdentity();
    const created = await prepare(identity);
    await Promise.all([
      writeFile(created.paths.speakerPlanPath, '{"version":999}\n'),
      writeFile(created.paths.progressPath, '{"completedPhrases":2}'),
    ]);

    const reset = await openMediaDubbingCheckpoint(identity);

    expect(reset.manifest).toBeUndefined();
    await expect(access(reset.paths.progressPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('discards a checkpoint when a declared speaker reference is missing', async () => {
    const identity = await createIdentity();
    const created = await prepare(identity);
    await rm(
      mediaDubbingReferencePath(created.paths, 'speaker-0001'),
      { force: true },
    );

    const reset = await openMediaDubbingCheckpoint(identity);

    expect(reset.manifest).toBeUndefined();
    await expect(access(reset.paths.speakerPlanPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects speaker ids that could escape the managed reference directory', async () => {
    const identity = await createIdentity();
    const created = await openMediaDubbingCheckpoint(identity);

    expect(() =>
      mediaDubbingReferencePath(created.paths, '../speaker-0001'),
    ).toThrow('DATA_INTEGRITY_ERROR');
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
