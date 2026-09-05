import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  type SubtitleSourceTrackV1,
} from './contracts';
import {
  readOrRepairSubtitleSourceArtifact,
  readSubtitleSourceTrackFile,
  readSubtitleSourceTrackFileForRecovery,
} from './subtitle-artifact-files';

function track(
  cues: SubtitleSourceTrackV1['cues'],
): SubtitleSourceTrackV1 {
  return {
    version: 1,
    kind: 'subtitle-source',
    sourceRevision: 'media-revision',
    language: 'en',
    origin: 'asr',
    engine: { id: 'asr', version: '1', model: 'model', backend: 'cpu' },
    generatedTime: 100,
    cues,
  };
}

function request(directory: string): AssetArtifactRequest {
  return {
    assetId: 'asset',
    producerId: 'builtin.media-subtitles.transcription',
    artifactKey: 'source.auto',
    workspacePath: directory,
    source: {
      assetId: 'asset',
      mediaType: 'audio/mpeg',
      absolutePath: join(directory, 'audio.mp3'),
      revision: 'media-revision',
    },
  };
}

function artifact(
  input: AssetArtifactRequest,
  path: string,
  revision: string,
): ResolvedAssetArtifact {
  return {
    absolutePath: path,
    cacheHit: true,
    artifact: {
      assetId: input.assetId,
      producerId: input.producerId,
      artifactKey: input.artifactKey,
      relativePath: `.learning-companion/artifacts/${revision}.json`,
      mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
      sourceRevision: input.source.revision,
      producerVersion: '7',
      artifactRevision: revision,
      updatedTime: 100,
    },
  };
}

describe('subtitle artifact source recovery', () => {
  it('repairs an existing zero-duration cue without changing its identity or text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-recovery-'));
    try {
      const path = join(directory, 'source.json');
      const value = track([
        {
          id: 'cue-before',
          startMs: 1_000,
          endMs: 2_000,
          text: 'before',
          sourceCueIds: ['raw-before'],
        },
        {
          id: 'cue-zero',
          startMs: 2_500,
          endMs: 2_500,
          text: 'so',
          sourceCueIds: ['raw-zero'],
        },
        {
          id: 'cue-after',
          startMs: 3_000,
          endMs: 4_000,
          text: 'after',
          sourceCueIds: ['raw-after'],
        },
      ]);
      await writeFile(path, JSON.stringify(value));

      const recovered = await readSubtitleSourceTrackFileForRecovery(path);

      expect(recovered.repaired).toBe(true);
      expect(recovered.track.cues).toEqual([
        value.cues[0],
        {
          ...value.cues[1],
          startMs: 2_250,
          endMs: 2_700,
        },
        value.cues[2],
      ]);
      await expect(readSubtitleSourceTrackFile(path)).rejects.toMatchObject({
        name: 'SubtitleTrackValidationError',
        kind: 'zero-duration',
        cueId: 'cue-zero',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not repair reversed or otherwise unrepairable source timelines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-recovery-'));
    try {
      const reversedPath = join(directory, 'reversed.json');
      await writeFile(
        reversedPath,
        JSON.stringify(
          track([
            {
              id: 'cue-reversed',
              startMs: 2_000,
              endMs: 1_000,
              text: 'bad',
              sourceCueIds: ['raw-bad'],
            },
          ]),
        ),
      );
      await expect(
        readSubtitleSourceTrackFileForRecovery(reversedPath),
      ).rejects.toMatchObject({
        name: 'SubtitleTrackValidationError',
        kind: 'malformed',
        field: 'cue-reversed.endMs',
        cueId: 'cue-reversed',
      });

      const outsideSpeakerPath = join(directory, 'outside-speaker.json');
      await writeFile(
        outsideSpeakerPath,
        JSON.stringify({
          ...track([
            {
              id: 'cue-outside',
              startMs: 3_000,
              endMs: 3_000,
              text: 'so',
              sourceCueIds: ['raw-outside'],
              speakerId: 'speaker-0001',
            },
          ]),
          speakerAnalysis: {
            method: 'post-hoc-diarization',
            supportsOverlappingTranscription: true,
            segments: [
              { speakerId: 'speaker-0001', startMs: 0, endMs: 2_000 },
            ],
          },
        }),
      );
      await expect(
        readSubtitleSourceTrackFileForRecovery(outsideSpeakerPath),
      ).rejects.toMatchObject({
        name: 'SubtitleTrackValidationError',
        kind: 'unrepairable',
        cueId: 'cue-outside',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serializes one idempotent Artifact replacement for concurrent readers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-recovery-'));
    try {
      const sourcePath = join(directory, 'source.json');
      const stagingDirectory = join(directory, 'staging');
      const input = request(directory);
      const invalid = track([
        {
          id: 'cue-zero',
          startMs: 1_000,
          endMs: 1_000,
          text: 'so',
          sourceCueIds: ['raw-zero'],
        },
      ]);
      await writeFile(sourcePath, JSON.stringify(invalid));
      const current = artifact(input, sourcePath, 'old-revision');
      let committed = current;
      const getCached = async () => committed;
      const replace = vi.fn<NonNullable<AssetArtifactServiceApi['replace']>>(
        async (replaceRequest, produce, signal) => {
          if (!produce) throw new Error('replacement producer missing');
          await mkdir(stagingDirectory, { recursive: true });
          const produced = await produce(
            {
              source: replaceRequest.source,
              artifactKey: replaceRequest.artifactKey,
              workspacePath: replaceRequest.workspacePath,
              stagingDirectory,
            },
            signal ?? new AbortController().signal,
          );
          committed = artifact(input, produced.filePath, 'new-revision');
          return committed;
        },
      );
      const artifacts = {
        getCached: vi.fn(getCached),
        replace: vi.fn(replace),
      } as unknown as AssetArtifactServiceApi;

      const [first, second] = await Promise.all([
        readOrRepairSubtitleSourceArtifact(artifacts, input, current),
        readOrRepairSubtitleSourceArtifact(artifacts, input, current),
      ]);

      expect(artifacts.replace).toHaveBeenCalledOnce();
      expect(first.repaired).toBe(true);
      expect(second).toMatchObject({
        artifact: first.artifact,
        track: first.track,
        repaired: false,
      });
      expect(first.track.cues[0]).toMatchObject({
        id: 'cue-zero',
        startMs: 750,
        endMs: 1_200,
        text: 'so',
      });
      await expect(
        readFile(first.artifact.absolutePath, 'utf8'),
      ).resolves.toContain('"endMs": 1200');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
