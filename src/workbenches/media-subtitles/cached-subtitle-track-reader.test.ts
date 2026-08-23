import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createContentRevision } from '../../main/content/content-revision';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationTrackV1,
} from './contracts';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
} from './transcription-producer';
import {
  MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
  createSubtitleTranslationArtifactKey,
} from './translation-producer';
import { CachedSubtitleTrackReader } from './cached-subtitle-track-reader';

async function withFixture(
  action: (fixture: {
    readonly directory: string;
    readonly videoPath: string;
    readonly sourcePath: string;
    readonly translationPath: string;
    readonly source: SubtitleSourceTrackV1;
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-reader-'));
  const videoBytes = Buffer.from('video-content');
  const source: SubtitleSourceTrackV1 = {
    version: 1,
    kind: 'subtitle-source',
    sourceRevision: createContentRevision(videoBytes),
    language: 'en',
    origin: 'asr',
    engine: { id: 'asr', version: '1', model: 'model', backend: 'cpu' },
    generatedTime: 1,
    cues: [
      {
        id: 'cue-1',
        startMs: 0,
        endMs: 1_000,
        text: 'Hello.',
        sourceCueIds: ['raw-1'],
      },
    ],
  };
  const translation: SubtitleTranslationTrackV1 = {
    version: 1,
    kind: 'subtitle-translation',
    sourceTrackRevision: 'track-revision',
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
    profile: 'quality',
    engine: {
      id: 'translation',
      version: '1',
      model: 'model',
      backend: 'cpu',
    },
    generatedTime: 2,
    cues: [{ sourceCueId: 'cue-1', text: '你好。' }],
  };
  const videoPath = join(directory, 'video.mp4');
  const sourcePath = join(directory, 'source.json');
  const translationPath = join(directory, 'translation.json');
  await Promise.all([
    writeFile(videoPath, videoBytes),
    writeFile(sourcePath, JSON.stringify(source)),
    writeFile(translationPath, JSON.stringify(translation)),
  ]);
  try {
    await action({ directory, videoPath, sourcePath, translationPath, source });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('CachedSubtitleTrackReader', () => {
  it('reads matching source and translation Artifacts without generating either', async () => {
    await withFixture(async (fixture) => {
      const getCached = vi.fn(
        async (request: {
          readonly producerId: string;
          readonly source: { readonly revision: string };
        }) => {
          if (request.producerId === MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID) {
            expect(request.source.revision).toBe(fixture.source.sourceRevision);
            return {
              artifact: {
                assetId: 'asset-1',
                producerId: MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
                artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
                relativePath: 'source.json',
                mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
                sourceRevision: fixture.source.sourceRevision,
                producerVersion: '3',
                artifactRevision: 'track-revision',
                updatedTime: 1,
              },
              absolutePath: fixture.sourcePath,
              cacheHit: true,
            };
          }
          if (request.producerId === MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID) {
            expect(request.source.revision).toBe('track-revision');
            return {
              artifact: {
                assetId: 'asset-1',
                producerId: MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
                artifactKey: createSubtitleTranslationArtifactKey(
                  'en',
                  'zh-Hans',
                ),
                relativePath: 'translation.json',
                mediaType: SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
                sourceRevision: 'track-revision',
                producerVersion: '1',
                artifactRevision: 'translation-revision',
                updatedTime: 2,
              },
              absolutePath: fixture.translationPath,
              cacheHit: true,
            };
          }
          return undefined;
        },
      );
      const reader = new CachedSubtitleTrackReader({ getCached } as never);
      const tracks = await reader.read({
        assetId: 'asset-1',
        mediaType: 'video/mp4',
        absolutePath: fixture.videoPath,
        workspacePath: fixture.directory,
        contentVersion: '100',
      });
      expect(tracks?.source).toEqual(fixture.source);
      expect(tracks?.translation?.cues).toEqual([
        { sourceCueId: 'cue-1', text: '你好。' },
      ]);
      expect(getCached).toHaveBeenCalledTimes(2);
    });
  });

  it('returns no context when the source Artifact is not cached', async () => {
    await withFixture(async (fixture) => {
      const getCached = vi.fn(async () => undefined);
      const reader = new CachedSubtitleTrackReader({ getCached } as never);
      await expect(
        reader.read({
          assetId: 'asset-1',
          mediaType: 'video/mp4',
          absolutePath: fixture.videoPath,
          workspacePath: fixture.directory,
          contentVersion: '100',
        }),
      ).resolves.toBeUndefined();
      expect(getCached).toHaveBeenCalledOnce();
    });
  });

  it('recomputes the source revision when the Asset content version changes', async () => {
    await withFixture(async (fixture) => {
      const revisions: string[] = [];
      const getCached = vi.fn(async (request: {
        readonly source: { readonly revision: string };
      }) => {
        revisions.push(request.source.revision);
        return undefined;
      });
      const reader = new CachedSubtitleTrackReader({ getCached } as never);
      await reader.read({
        assetId: 'asset-1',
        mediaType: 'video/mp4',
        absolutePath: fixture.videoPath,
        workspacePath: fixture.directory,
        contentVersion: '100',
      });
      const changedContent = Buffer.from('changed-video-content');
      await writeFile(fixture.videoPath, changedContent);
      await reader.read({
        assetId: 'asset-1',
        mediaType: 'video/mp4',
        absolutePath: fixture.videoPath,
        workspacePath: fixture.directory,
        contentVersion: '101',
      });
      expect(revisions).toEqual([
        fixture.source.sourceRevision,
        createContentRevision(changedContent),
      ]);
    });
  });

  it('keeps the original track when no completed translation is cached', async () => {
    await withFixture(async (fixture) => {
      const getCached = vi.fn(
        async (request: { readonly producerId: string }) =>
          request.producerId === MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID
            ? {
                artifact: {
                  assetId: 'asset-1',
                  producerId: MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
                  artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
                  relativePath: 'source.json',
                  mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
                  sourceRevision: fixture.source.sourceRevision,
                  producerVersion: '3',
                  artifactRevision: 'track-revision',
                  updatedTime: 1,
                },
                absolutePath: fixture.sourcePath,
                cacheHit: true,
              }
            : undefined,
      );
      const reader = new CachedSubtitleTrackReader({ getCached } as never);
      const tracks = await reader.read({
        assetId: 'asset-1',
        mediaType: 'video/mp4',
        absolutePath: fixture.videoPath,
        workspacePath: fixture.directory,
        contentVersion: '100',
      });
      expect(tracks).toEqual({ source: fixture.source });
    });
  });
});
