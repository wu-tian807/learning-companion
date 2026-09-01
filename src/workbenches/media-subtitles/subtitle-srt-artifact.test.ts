import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import { SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE } from './contracts';
import {
  MEDIA_SUBTITLE_SOURCE_SRT_ARTIFACT_KEY,
  MEDIA_SUBTITLE_SRT_PRODUCER_ID,
  MediaSubtitleSrtProducer,
  SUBTITLE_SRT_ARTIFACT_MEDIA_TYPE,
  createSubtitleTranslationSrtArtifactKey,
  serializeSubtitleSrt,
} from './subtitle-srt-artifact';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function request(directory: string): AssetArtifactRequest {
  return {
    assetId: 'video',
    producerId: MEDIA_SUBTITLE_SRT_PRODUCER_ID,
    artifactKey: MEDIA_SUBTITLE_SOURCE_SRT_ARTIFACT_KEY,
    workspacePath: directory,
    source: {
      assetId: 'video',
      mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
      absolutePath: join(directory, 'source.json'),
      revision: 'source-artifact-revision',
    },
  };
}

describe('MediaSubtitleSrtProducer', () => {
  it('serializes standard SRT timestamps and preserves multiline cue text', () => {
    expect(
      serializeSubtitleSrt([
        { startMs: 0, endMs: 1_234, text: 'Hello' },
        {
          startMs: 3_661_001,
          endMs: 3_662_002,
          text: 'Second line\r\ncontinued',
        },
      ]),
    ).toBe(
      '1\n00:00:00,000 --> 00:00:01,234\nHello\n\n' +
        '2\n01:01:01,001 --> 01:01:02,002\nSecond line\ncontinued\n',
    );
  });

  it('commits a UTF-8 SRT through the existing Artifact service boundary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-srt-'));
    temporaryDirectories.push(directory);
    const stagingDirectory = join(directory, 'staging');
    await mkdir(stagingDirectory);
    await writeFile(join(directory, 'source.json'), '{}');
    const producer = new MediaSubtitleSrtProducer();
    let outputPath: string | undefined;
    const getOrCreate = vi.fn(
      async (
        artifactRequest: AssetArtifactRequest,
        signal?: AbortSignal,
      ): Promise<ResolvedAssetArtifact> => {
        const produced = await producer.produce(
          { ...artifactRequest, stagingDirectory },
          signal ?? new AbortController().signal,
        );
        outputPath = produced.filePath;
        return {
          absolutePath: produced.filePath,
          cacheHit: false,
          artifact: {
            assetId: artifactRequest.assetId,
            producerId: producer.id,
            artifactKey: artifactRequest.artifactKey,
            relativePath: '.learning-companion/artifacts/video/subtitles.srt',
            mediaType: produced.mediaType,
            sourceRevision: artifactRequest.source.revision,
            producerVersion: producer.version,
            artifactRevision: 'srt-revision',
            updatedTime: 1,
          },
        };
      },
    );
    const artifacts: AssetArtifactServiceApi = {
      listAvailableByAsset: vi.fn(async () => []),
      getCached: vi.fn(),
      getOrCreate,
    };

    await producer.materialize(
      artifacts,
      request(directory),
      [{ startMs: 0, endMs: 1_000, text: '你好，world。' }],
    );

    expect(outputPath).toBeDefined();
    expect(await readFile(outputPath!, 'utf8')).toContain('你好，world。');
    expect(producer.version).toBe('1');
    expect(SUBTITLE_SRT_ARTIFACT_MEDIA_TYPE).toBe('application/x-subrip');
  });

  it('rejects conflicting content for the same active Artifact identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-srt-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'source.json'), '{}');
    const producer = new MediaSubtitleSrtProducer();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const artifacts = {
      listAvailableByAsset: vi.fn(async () => []),
      getCached: vi.fn(),
      getOrCreate: vi.fn(async () => {
        await gate;
        return {} as ResolvedAssetArtifact;
      }),
    } satisfies AssetArtifactServiceApi;
    const first = producer.materialize(
      artifacts,
      request(directory),
      [{ startMs: 0, endMs: 1_000, text: 'First' }],
    );
    await vi.waitFor(() => expect(artifacts.getOrCreate).toHaveBeenCalledOnce());

    await expect(
      producer.materialize(
        artifacts,
        request(directory),
        [{ startMs: 0, endMs: 1_000, text: 'Different' }],
      ),
    ).rejects.toMatchObject({ code: 'REGISTRATION_CONFLICT' });
    release!();
    await first;
  });

  it('uses a stable translated-SRT key and rejects same-language translation', () => {
    expect(createSubtitleTranslationSrtArtifactKey('en', 'zh-Hans')).toBe(
      'translation.en.zh-Hans.quality.srt',
    );
    expect(() =>
      createSubtitleTranslationSrtArtifactKey('en', 'en'),
    ).toThrow('DATA_INTEGRITY_ERROR');
  });
});
