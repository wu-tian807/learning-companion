import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { MediaSubtitleRuntimeResolverApi } from './external-libraries/media-subtitle-runtime';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  type SubtitleSourceTrackV1,
} from './contracts';
import {
  MediaSubtitleTranslationProducer,
  createSubtitleTranslationArtifactKey,
  type SubtitleTranslationSession,
} from './translation-producer';

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-translation-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const sourceTrack: SubtitleSourceTrackV1 = {
  version: 1,
  kind: 'subtitle-source',
  sourceRevision: 'video-revision',
  language: 'en',
  origin: 'asr',
  engine: {
    id: 'whisper.cpp',
    version: '1',
    model: 'large-v3-turbo',
    backend: 'cuda',
  },
  generatedTime: 100,
  cues: [
    { id: 'cue-1', startMs: 0, endMs: 900, text: 'Hello.', sourceCueIds: ['raw-1'] },
    { id: 'cue-2', startMs: 1_000, endMs: 1_900, text: 'World.', sourceCueIds: ['raw-2'] },
  ],
};

function runtimes(): MediaSubtitleRuntimeResolverApi {
  return {
    requireMediaDecoder: vi.fn(async () => {
      throw new Error('not used');
    }),
    requireTranscription: vi.fn(async () => {
      throw new Error('not used');
    }),
    requireFastTranslation: vi.fn(async () => {
      throw new Error('not used');
    }),
    requireQualityTranslation: vi.fn(async () => ({
      executablePath: 'C:\\runtime\\llama-server.exe',
      modelPath: 'C:\\runtime\\model.gguf',
      backend: 'vulkan' as const,
    })),
  };
}

describe('MediaSubtitleTranslationProducer', () => {
  it('translates each cue with local context and writes results in source order', async () => {
    await withDirectory(async (directory) => {
      const sourcePath = join(directory, 'source.json');
      await writeFile(sourcePath, JSON.stringify(sourceTrack));
      const progress = vi.fn();
      const translate = vi.fn(async (prompt: string) =>
        prompt.includes('Hello.') && prompt.includes('[Source Text]\nHello.')
          ? '你好。'
          : '世界。');
      const close = vi.fn(async () => undefined);
      const session: SubtitleTranslationSession = { translate, close };
      const startSession = vi.fn(async () => session);
      const producer = new MediaSubtitleTranslationProducer(
        runtimes(),
        progress,
        {
          now: () => 200,
          startSession,
        },
      );

      const result = await producer.produce({
        artifactKey: createSubtitleTranslationArtifactKey('en', 'zh-Hans'),
        workspacePath: directory,
        stagingDirectory: directory,
        source: {
          assetId: 'video',
          mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          absolutePath: sourcePath,
          revision: 'source-artifact-revision',
        },
      }, new AbortController().signal);
      const track = JSON.parse(await readFile(result.filePath, 'utf8'));

      expect(startSession).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(translate).toHaveBeenCalledTimes(2);
      expect(translate.mock.calls[0][0]).toContain(
        'Next subtitle: World.',
      );
      expect(track).toMatchObject({
        sourceTrackRevision: 'source-artifact-revision',
        sourceLanguage: 'en',
        targetLanguage: 'zh-Hans',
        generatedTime: 200,
        engine: { backend: 'vulkan' },
        cues: [
          { sourceCueId: 'cue-1', text: '你好。' },
          { sourceCueId: 'cue-2', text: '世界。' },
        ],
      });
      expect(progress).toHaveBeenCalledTimes(2);
    });
  });

  it('rejects a translation key that disagrees with the source track', async () => {
    await withDirectory(async (directory) => {
      const sourcePath = join(directory, 'source.json');
      await writeFile(sourcePath, JSON.stringify(sourceTrack));
      const startSession = vi.fn();
      const producer = new MediaSubtitleTranslationProducer(
        runtimes(),
        vi.fn(),
        { startSession },
      );

      await expect(producer.produce({
        artifactKey: createSubtitleTranslationArtifactKey('zh-Hans', 'en'),
        workspacePath: directory,
        stagingDirectory: directory,
        source: {
          assetId: 'video',
          mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          absolutePath: sourcePath,
          revision: 'source-artifact-revision',
        },
      }, new AbortController().signal)).rejects.toMatchObject({
        code: 'DATA_INTEGRITY_ERROR',
      });
      expect(startSession).not.toHaveBeenCalled();
    });
  });

  it('closes the model session and preserves cancellation', async () => {
    await withDirectory(async (directory) => {
      const sourcePath = join(directory, 'source.json');
      await writeFile(sourcePath, JSON.stringify(sourceTrack));
      const aborted = new DOMException('cancelled', 'AbortError');
      const close = vi.fn(async () => undefined);
      const producer = new MediaSubtitleTranslationProducer(
        runtimes(),
        vi.fn(),
        {
          startSession: vi.fn(async () => ({
            translate: vi.fn(async () => { throw aborted; }),
            close,
          })),
        },
      );

      await expect(producer.produce({
        artifactKey: createSubtitleTranslationArtifactKey('en', 'zh-Hans'),
        workspacePath: directory,
        stagingDirectory: directory,
        source: {
          assetId: 'video',
          mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          absolutePath: sourcePath,
          revision: 'source-artifact-revision',
        },
      }, new AbortController().signal)).rejects.toBe(aborted);
      expect(close).toHaveBeenCalledOnce();
    });
  });
});
