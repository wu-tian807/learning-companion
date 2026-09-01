import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  type SubtitleSourceTrackV1,
} from '../media-subtitles/contracts';
import {
  DUBBING_SPEAKER_TRACK_ARTIFACT_KEY,
  DUBBING_SPEAKER_TRACK_ARTIFACT_MEDIA_TYPE,
  DUBBING_SPEAKER_TRACK_PRODUCER_ID,
  DubbingSpeakerTrackArtifactProducer,
  readDubbingSpeakerTrackFile,
} from './dubbing-speaker-track-artifact';
import type { DubbingSpeakerTrackV1 } from './dubbing-speaker-track';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function source(): SubtitleSourceTrackV1 {
  return {
    version: 1,
    kind: 'subtitle-source',
    sourceRevision: 'asset-revision',
    language: 'en',
    origin: 'asr',
    engine: { id: 'asr', version: '1', model: 'model', backend: 'cpu' },
    generatedTime: 100,
    cues: [
      {
        id: 'cue-1',
        startMs: 0,
        endMs: 3_000,
        text: 'First sentence.',
        sourceCueIds: ['raw-1'],
      },
      {
        id: 'cue-2',
        startMs: 3_200,
        endMs: 6_000,
        text: 'Second sentence.',
        sourceCueIds: ['raw-2'],
      },
    ],
  };
}

function track(): DubbingSpeakerTrackV1 {
  return {
    version: 1,
    kind: 'dubbing-speaker-track',
    sourceTrackRevision: 'source-track-revision',
    cues: [
      { sourceCueId: 'cue-1', speakerId: 'speaker-0001', status: 'stable' },
      { sourceCueId: 'cue-2', speakerId: 'speaker-0001', status: 'stable' },
    ],
    profiles: [
      {
        speakerId: 'speaker-0001',
        mode: 'reference',
        referenceStartMs: 0,
        referenceEndMs: 6_000,
      },
    ],
  };
}

function request(directory: string): AssetArtifactRequest {
  return {
    assetId: 'audio',
    producerId: DUBBING_SPEAKER_TRACK_PRODUCER_ID,
    artifactKey: DUBBING_SPEAKER_TRACK_ARTIFACT_KEY,
    workspacePath: directory,
    source: {
      assetId: 'audio',
      mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
      absolutePath: join(directory, 'source.json'),
      revision: 'source-track-revision',
    },
  };
}

describe('DubbingSpeakerTrackArtifactProducer', () => {
  it('materializes the validated track through ArtifactService', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-speaker-track-'));
    temporaryDirectories.push(directory);
    const stagingDirectory = join(directory, 'staging');
    await mkdir(stagingDirectory, { recursive: true });
    const producer = new DubbingSpeakerTrackArtifactProducer();
    const artifactRequest = request(directory);
    const getOrCreate = vi.fn(async (_request, signal) => {
      const produced = await producer.produce(
        {
          source: artifactRequest.source,
          artifactKey: artifactRequest.artifactKey,
          workspacePath: artifactRequest.workspacePath,
          stagingDirectory,
        },
        signal ?? new AbortController().signal,
      );
      return {
        absolutePath: produced.filePath,
        cacheHit: false,
        artifact: {
          assetId: 'audio',
          producerId: producer.id,
          artifactKey: artifactRequest.artifactKey,
          relativePath: 'artifacts/speaker-track.json',
          mediaType: produced.mediaType,
          sourceRevision: artifactRequest.source.revision,
          producerVersion: producer.version,
          artifactRevision: 'speaker-track-artifact-revision',
          updatedTime: 100,
        },
      } satisfies ResolvedAssetArtifact;
    });
    const artifacts = {
      listAvailableByAsset: vi.fn(async () => []),
      getCached: vi.fn(),
      getOrCreate,
    } as AssetArtifactServiceApi;

    const resolved = await producer.materialize(
      artifacts,
      artifactRequest,
      source(),
      track(),
    );

    expect(resolved.artifact.mediaType).toBe(
      DUBBING_SPEAKER_TRACK_ARTIFACT_MEDIA_TYPE,
    );
    expect(
      JSON.parse(await readFile(resolved.absolutePath, 'utf8')),
    ).toEqual(track());
  });

  it('rejects a stale revision before writing and rejects reordered source cues', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-speaker-track-'));
    temporaryDirectories.push(directory);
    const producer = new DubbingSpeakerTrackArtifactProducer();
    const artifactRequest = request(directory);
    const getOrCreate = vi.fn();
    const artifacts = {
      listAvailableByAsset: vi.fn(async () => []),
      getCached: vi.fn(),
      getOrCreate,
    } as unknown as AssetArtifactServiceApi;

    await expect(
      producer.materialize(
        artifacts,
        artifactRequest,
        source(),
        {
          ...track(),
          sourceTrackRevision: 'stale',
        },
      ),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    expect(getOrCreate).not.toHaveBeenCalled();
    await expect(
      producer.materialize(
        artifacts,
        artifactRequest,
        source(),
        { ...track(), cues: [...track().cues].reverse() },
      ),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');

    const path = join(directory, 'speaker-track.json');
    await writeFile(
      path,
      JSON.stringify({
        ...track(),
        cues: [...track().cues].reverse(),
      }),
      'utf8',
    );
    await expect(
      readDubbingSpeakerTrackFile(path, source(), 'source-track-revision'),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });
});
