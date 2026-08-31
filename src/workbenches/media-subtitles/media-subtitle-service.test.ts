import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../main/assets/asset-service';
import type { ProjectLookup } from '../../main/projects/project-database';
import type { GenerationTaskServiceApi } from '../../main/generation/generation-task-service';
import { AppError } from '../../main/errors/app-error';
import type { AssetChangedEvent, AssetSnapshot } from '../../shared/assets';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationTrackV1,
} from './contracts';
import type { MediaSubtitleRuntimeResolverApi } from './external-libraries/media-subtitle-runtime';
import { MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID } from './transcription-producer';
import {
  MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
  SubtitleTranslationProgressHub,
} from './translation-producer';
import { MediaSubtitleService } from './media-subtitle-service';
import { MediaSubtitleSourceTaskQueue } from './source-task-queue';

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'lc-video-subtitles-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const videoAsset: AssetSnapshot = {
  id: 'video',
  projectId: 'project',
  name: '课程',
  mediaType: 'video/mp4',
  creationKind: 'imported',
  contentRef: { kind: 'local-file', base: 'absolute', path: 'video.mp4' },
  contentStatus: { availability: 'available', checkedTime: 100 },
  createdTime: 100,
  updatedTime: 100,
};

function sourceTrack(language: 'en' | 'unknown'): SubtitleSourceTrackV1 {
  return {
    version: 1,
    kind: 'subtitle-source',
    sourceRevision: 'video-revision',
    language,
    origin: 'asr',
    engine: { id: 'asr', version: '1', model: 'model', backend: 'cpu' },
    generatedTime: 100,
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
}

function translationTrack(): SubtitleTranslationTrackV1 {
  return {
    version: 1,
    kind: 'subtitle-translation',
    sourceTrackRevision: 'source-artifact-revision',
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
    profile: 'quality',
    engine: { id: 'translator', version: '1', model: 'model', backend: 'cpu' },
    generatedTime: 200,
    cues: [{ sourceCueId: 'cue-1', text: '你好。' }],
  };
}

function resolvedArtifact(
  request: AssetArtifactRequest,
  absolutePath: string,
  mediaType: string,
  artifactRevision: string,
): ResolvedAssetArtifact {
  return {
    absolutePath,
    cacheHit: false,
    artifact: {
      assetId: request.assetId,
      producerId: request.producerId,
      artifactKey: request.artifactKey,
      relativePath: `artifacts/${request.producerId}.json`,
      mediaType,
      sourceRevision: request.source.revision,
      producerVersion: '1',
      artifactRevision,
      updatedTime: 100,
    },
  };
}

function runtimes(): MediaSubtitleRuntimeResolverApi {
  const transcription = {
    kind: 'sensevoice' as const,
    profile: 'cpu' as const,
    executablePath: 'sensevoice.exe',
    vadExecutablePath: 'vad.exe',
    modelPath: 'sensevoice.gguf',
    vadModelPath: 'vad.gguf',
  };
  return {
    requireTranscription: vi.fn(async () => transcription),
    requireMediaDecoder: vi.fn(async () => {
      throw new Error('producer not executed in this service test');
    }),
    withRuntime: vi.fn(),
  };
}

function generationTasks(): GenerationTaskServiceApi {
  return {
    subscribe: vi.fn(() => () => undefined),
    list: vi.fn(() => []),
    start: vi.fn(),
    retry: vi.fn(),
  } as unknown as GenerationTaskServiceApi;
}

describe('MediaSubtitleService', () => {
  it('accepts audio media types supplied by the owning Workbench', async () => {
    const audioAsset: AssetSnapshot = {
      ...videoAsset,
      id: 'audio',
      name: '课程音频',
      mediaType: 'audio/mpeg',
      contentRef: {
        kind: 'local-file',
        base: 'absolute',
        path: 'audio.mp3',
      },
    };
    const requireTranscription = vi.fn(async () => {
      throw new AppError('EXTERNAL_LIBRARY_NOT_INSTALLED');
    });
    const service = new MediaSubtitleService(
      {
        get: vi.fn(() => audioAsset),
        subscribe: vi.fn(() => () => undefined),
      } as unknown as AssetServiceApi,
      { get: vi.fn() },
      {} as AssetArtifactServiceApi,
      {
        requireTranscription,
        requireMediaDecoder: vi.fn(),
        withRuntime: vi.fn(),
      },
      new MediaSubtitleSourceTaskQueue(),
      generationTasks(),
      new SubtitleTranslationProgressHub(),
      ['audio/mpeg'],
    );

    await service.ensureSource('project', 'audio');

    expect(requireTranscription).toHaveBeenCalledOnce();
    expect(service.getSnapshot('audio')).toMatchObject({
      phase: 'runtime-required',
      message: expect.stringContaining('字幕组件'),
    });
  });

  it('starts source transcription on an imported video but translates only on demand', async () => {
    await withDirectory(async (directory) => {
      const videoPath = join(directory, 'video.mp4');
      const sourcePath = join(directory, 'source.json');
      const translationPath = join(directory, 'translation.json');
      await writeFile(videoPath, 'video bytes');
      await writeFile(sourcePath, JSON.stringify(sourceTrack('en')));
      await writeFile(translationPath, JSON.stringify(translationTrack()));
      let assetChanged: ((event: AssetChangedEvent) => void) | undefined;
      const assets = {
        get: vi.fn(() => videoAsset),
        resolveContent: vi.fn(async () => ({
          contentRef: videoAsset.contentRef,
          contentStatus: videoAsset.contentStatus,
          location: { kind: 'local-file' as const, absolutePath: videoPath },
          handle: { close: vi.fn(async () => undefined) },
        })),
        subscribe: vi.fn((listener) => {
          assetChanged = listener;
          return () => undefined;
        }),
      } as unknown as AssetServiceApi;
      const projects: ProjectLookup = {
        get: vi.fn(() => ({
          id: 'project',
          name: 'Project',
          icon: 'P',
          createdTime: 100,
          pinned: false,
          workspacePath: directory,
        })),
      };
      const getOrCreate = vi.fn(async (request: AssetArtifactRequest) => {
        if (request.producerId === MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID) {
          await writeFile(
            sourcePath,
            JSON.stringify({
              ...sourceTrack('en'),
              sourceRevision: request.source.revision,
            }),
          );
          return resolvedArtifact(
            request,
            sourcePath,
            SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
            'source-artifact-revision',
          );
        }
        return resolvedArtifact(
          request,
          translationPath,
          SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
          'translation-artifact-revision',
        );
      });
      const artifacts = {
        getCached: vi.fn(async (request: AssetArtifactRequest) =>
          request.producerId === MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID
            ? resolvedArtifact(
                request,
                translationPath,
                SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
                'translation-artifact-revision',
              )
            : undefined,
        ),
        getOrCreate,
      } as AssetArtifactServiceApi;
      const service = new MediaSubtitleService(
        assets,
        projects,
        artifacts,
        runtimes(),
        new MediaSubtitleSourceTaskQueue(),
        generationTasks(),
        new SubtitleTranslationProgressHub(),
        ['video/mp4'],
      );

      assetChanged?.({ projectId: 'project', asset: videoAsset });
      await vi.waitFor(() => expect(getOrCreate).toHaveBeenCalledTimes(1));
      expect(getOrCreate.mock.calls[0][0].producerId).toBe(
        MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
      );
      expect(service.getSnapshot('video').phase).toBe('source-ready');
      await service.ensureTranslation('project', 'video');

      const translationRequest = vi
        .mocked(artifacts.getCached)
        .mock.calls.find(
          ([request]) =>
            request.producerId === MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
        )?.[0];
      expect(translationRequest).toMatchObject({
        producerId: MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
        source: {
          mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          absolutePath: sourcePath,
          revision: 'source-artifact-revision',
        },
      });
      expect(service.getSnapshot('video')).toMatchObject({
        phase: 'ready',
        completedCues: 1,
        translation: { targetLanguage: 'zh-Hans' },
      });
    });
  });

  it('reports an unsupported detected language without starting translation', async () => {
    await withDirectory(async (directory) => {
      const videoPath = join(directory, 'video.mp4');
      const sourcePath = join(directory, 'source.json');
      await writeFile(videoPath, 'video bytes');
      await writeFile(sourcePath, JSON.stringify(sourceTrack('unknown')));
      const assets = {
        get: vi.fn(() => videoAsset),
        resolveContent: vi.fn(async () => ({
          contentRef: videoAsset.contentRef,
          contentStatus: videoAsset.contentStatus,
          location: { kind: 'local-file' as const, absolutePath: videoPath },
          handle: { close: vi.fn(async () => undefined) },
        })),
        subscribe: vi.fn(() => () => undefined),
      } as unknown as AssetServiceApi;
      const projects: ProjectLookup = {
        get: vi.fn(() => ({
          id: 'project',
          name: 'Project',
          icon: 'P',
          createdTime: 100,
          pinned: false,
          workspacePath: directory,
        })),
      };
      const getOrCreate = vi.fn(async (request: AssetArtifactRequest) => {
        await writeFile(
          sourcePath,
          JSON.stringify({
            ...sourceTrack('unknown'),
            sourceRevision: request.source.revision,
          }),
        );
        return resolvedArtifact(
          request,
          sourcePath,
          SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          'source-artifact-revision',
        );
      });
      const service = new MediaSubtitleService(
        assets,
        projects,
        { getCached: vi.fn(), getOrCreate } as AssetArtifactServiceApi,
        runtimes(),
        new MediaSubtitleSourceTaskQueue(),
        generationTasks(),
        new SubtitleTranslationProgressHub(),
        ['video/mp4'],
      );

      await service.ensureTranslation('project', 'video');

      expect(getOrCreate).toHaveBeenCalledOnce();
      expect(service.getSnapshot('video')).toMatchObject({
        phase: 'unsupported-language',
        message: expect.stringContaining('中文或英文'),
      });
    });
  });
});
