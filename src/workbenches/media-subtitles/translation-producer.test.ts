import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AssetArtifactServiceApi } from '../../main/artifacts/asset-artifact-service';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  type SubtitleTranslationTrackV1,
} from './contracts';
import {
  MediaSubtitleTranslationProducer,
  createSubtitleTranslationArtifactKey,
} from './translation-producer';

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-translation-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const track: SubtitleTranslationTrackV1 = {
  version: 1,
  kind: 'subtitle-translation',
  sourceTrackRevision: 'source-revision',
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  profile: 'quality',
  engine: { id: 'codex', version: '1', model: 'gpt', backend: 'agent' },
  generatedTime: 100,
  cues: [{ sourceCueId: 'cue-1', text: '你好。' }],
};

describe('MediaSubtitleTranslationProducer', () => {
  it('materializes a validated GenerationTask result through ArtifactService', async () => {
    await withDirectory(async (directory) => {
      const producer = new MediaSubtitleTranslationProducer();
      const request = {
        assetId: 'video',
        producerId: producer.id,
        artifactKey: createSubtitleTranslationArtifactKey('en', 'zh-Hans'),
        workspacePath: directory,
        source: {
          assetId: 'video',
          mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          absolutePath: join(directory, 'source.json'),
          revision: 'source-revision',
        },
      };
      const getOrCreate = vi.fn(async () => {
        const produced = await producer.produce(
          { ...request, stagingDirectory: directory },
          new AbortController().signal,
        );
        return {
          absolutePath: produced.filePath,
          cacheHit: false,
          artifact: {
            assetId: 'video',
            producerId: producer.id,
            producerVersion: producer.version,
            artifactKey: request.artifactKey,
            relativePath: 'translation.json',
            mediaType: produced.mediaType,
            sourceRevision: 'source-revision',
            artifactRevision: 'artifact-revision',
            updatedTime: 100,
          },
        };
      });
      const artifacts = { getOrCreate } as unknown as AssetArtifactServiceApi;

      const resolved = await producer.materialize(artifacts, request, track);
      expect(resolved.artifact.artifactRevision).toBe('artifact-revision');
      expect(JSON.parse(await readFile(resolved.absolutePath, 'utf8'))).toEqual(
        track,
      );
    });
  });

  it('does not accept direct production without a GenerationTask result', async () => {
    await withDirectory(async (directory) => {
      const producer = new MediaSubtitleTranslationProducer();
      await expect(
        producer.produce(
          {
            artifactKey: createSubtitleTranslationArtifactKey('en', 'zh-Hans'),
            workspacePath: directory,
            stagingDirectory: directory,
            source: {
              assetId: 'video',
              mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
              absolutePath: join(directory, 'source.json'),
              revision: 'source-revision',
            },
          },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code: 'DATA_INTEGRITY_ERROR',
      });
    });
  });

  it('rejects a track whose language or source revision disagrees with the Artifact key', async () => {
    const producer = new MediaSubtitleTranslationProducer();
    const artifacts = {
      getOrCreate: vi.fn(),
    } as unknown as AssetArtifactServiceApi;
    await expect(
      producer.materialize(
        artifacts,
        {
          assetId: 'video',
          producerId: producer.id,
          artifactKey: createSubtitleTranslationArtifactKey('zh-Hans', 'en'),
          workspacePath: 'C:\\workspace',
          source: {
            assetId: 'video',
            mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
            absolutePath: 'C:\\workspace\\source.json',
            revision: 'source-revision',
          },
        },
        track,
      ),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
    expect(artifacts.getOrCreate).not.toHaveBeenCalled();
  });
});
