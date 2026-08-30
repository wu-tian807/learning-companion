import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../main/assets/asset-service';
import { AppError } from '../../main/errors/app-error';
import type { ProjectLookup } from '../../main/projects/project-database';
import type { AssetSnapshot } from '../../shared/assets';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationTrackV1,
} from '../media-subtitles/contracts';
import type { MediaSubtitleRuntimeResolverApi } from '../media-subtitles/external-libraries/media-subtitle-runtime';
import { MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID } from '../media-subtitles/transcription-producer';
import { MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID } from '../media-subtitles/translation-producer';
import type { MediaSubtitleServiceApi } from '../media-subtitles/media-subtitle-service';
import type { VoxCpm2DubbingRuntimeResolverApi } from './external-libraries/voxcpm2-runtime';
import {
  DUBBING_SPEAKER_TRACK_ARTIFACT_KEY,
  DUBBING_SPEAKER_TRACK_ARTIFACT_MEDIA_TYPE,
  DUBBING_SPEAKER_TRACK_PRODUCER_ID,
} from './dubbing-speaker-track-artifact';
import type { DubbingSpeakerTrackV1 } from './dubbing-speaker-track';
import {
  VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
  VOXCPM2_DUBBING_PRODUCER_ID,
  MediaDubbingProgressHub,
  type VoxCpm2DubbingProducer,
} from './voxcpm2-dubbing-producer';
import { MediaDubbingService } from './media-dubbing-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const videoAsset: AssetSnapshot = {
  id: 'video',
  projectId: 'project',
  name: 'Video',
  mediaType: 'video/mp4',
  creationKind: 'imported',
  contentRef: { kind: 'local-file', base: 'absolute', path: 'video.mp4' },
  contentStatus: { availability: 'available', checkedTime: 100 },
  createdTime: 100,
  updatedTime: 100,
};

function sourceTrack(sourceRevision: string): SubtitleSourceTrackV1 {
  return {
    version: 1,
    kind: 'subtitle-source',
    sourceRevision,
    language: 'en',
    origin: 'asr',
    engine: { id: 'whisper', version: '1', model: 'turbo', backend: 'cuda' },
    generatedTime: 100,
    cues: [
      {
        id: 'cue-1',
        startMs: 0,
        endMs: 4_000,
        text: 'A complete source sentence.',
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
    engine: { id: 'codex', version: '1', model: 'gpt', backend: 'agent' },
    generatedTime: 200,
    cues: [{ sourceCueId: 'cue-1', text: '一条完整的译文。' }],
  };
}

function speakerTrack(): DubbingSpeakerTrackV1 {
  return {
    version: 1,
    kind: 'dubbing-speaker-track',
    sourceTrackRevision: 'source-artifact-revision',
    cues: [
      {
        sourceCueId: 'cue-1',
        speakerId: 'speaker-0001',
        status: 'stable',
      },
    ],
    profiles: [
      {
        speakerId: 'speaker-0001',
        mode: 'reference',
        referenceStartMs: 0,
        referenceEndMs: 4_000,
      },
    ],
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
      relativePath: `artifacts/${request.producerId}`,
      mediaType,
      sourceRevision: request.source.revision,
      producerVersion: '1',
      artifactRevision,
      updatedTime: 100,
    },
  };
}

async function createFixture(
  options: {
    readonly cachedDubbing?: boolean;
    readonly cachedSpeakerTrack?: boolean;
    readonly preparedSpeakerTrack?: boolean;
    readonly interruptedDubbing?: boolean;
    readonly materializeError?: unknown;
    readonly installationError?: unknown;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'lc-media-dubbing-service-'));
  temporaryDirectories.push(directory);
  const videoPath = join(directory, 'video.mp4');
  const sourcePath = join(directory, 'source.json');
  const translationPath = join(directory, 'translation.json');
  const dubbingPath = join(directory, 'dubbed.m4a');
  const speakerTrackPath = join(directory, 'speaker-track.json');
  await Promise.all([
    writeFile(videoPath, 'video'),
    writeFile(translationPath, JSON.stringify(translationTrack())),
    writeFile(dubbingPath, 'dubbing'),
    writeFile(speakerTrackPath, JSON.stringify(speakerTrack())),
  ]);

  const assets = {
    get: vi.fn(() => videoAsset),
    resolveContent: vi.fn(async () => ({
      contentRef: videoAsset.contentRef,
      contentStatus: videoAsset.contentStatus,
      location: { kind: 'local-file' as const, absolutePath: videoPath },
      handle: { close: vi.fn(async () => undefined) },
    })),
  } as unknown as AssetServiceApi;
  const projects: ProjectLookup = {
    get: vi.fn(() => ({
      id: 'project',
      name: 'Project',
      icon: 'P',
      pinned: false,
      createdTime: 100,
      workspacePath: directory,
    })),
  };
  const getCached = vi.fn(async (request: AssetArtifactRequest) => {
    if (request.producerId === MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID) {
      await writeFile(
        sourcePath,
        JSON.stringify(sourceTrack(request.source.revision)),
      );
      return resolvedArtifact(
        request,
        sourcePath,
        SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
        'source-artifact-revision',
      );
    }
    if (request.producerId === MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID) {
      return resolvedArtifact(
        request,
        translationPath,
        SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
        'translation-artifact-revision',
      );
    }
    if (
      request.producerId === DUBBING_SPEAKER_TRACK_PRODUCER_ID &&
      (options.cachedSpeakerTrack ?? options.cachedDubbing)
    ) {
      return resolvedArtifact(
        request,
        speakerTrackPath,
        DUBBING_SPEAKER_TRACK_ARTIFACT_MEDIA_TYPE,
        'speaker-track-artifact-revision',
      );
    }
    if (
      request.producerId === VOXCPM2_DUBBING_PRODUCER_ID &&
      options.cachedDubbing
    ) {
      return resolvedArtifact(
        request,
        dubbingPath,
        VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
        'dubbing-artifact-revision',
      );
    }
    return undefined;
  });
  const artifacts = {
    getCached,
    getOrCreate: vi.fn(),
  } as unknown as AssetArtifactServiceApi;
  const subtitles: MediaSubtitleServiceApi = {
    getSnapshot: vi.fn(() => ({
      phase: 'ready' as const,
      source: sourceTrack('video-revision'),
      translation: translationTrack(),
      partialTranslations: [],
      completedCues: 1,
      totalCues: 1,
    })),
    subscribe: vi.fn(() => () => undefined),
    ensureSource: vi.fn(async () => undefined),
    ensureTranslation: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
  const materialize = options.materializeError
    ? vi.fn(async () => Promise.reject(options.materializeError))
    : vi.fn(async (_artifacts, request: AssetArtifactRequest) =>
        resolvedArtifact(
          request,
          dubbingPath,
          VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
          'dubbing-artifact-revision',
        ),
      );
  const producer = {
    materialize,
    getPreparedSpeakerTrack: vi.fn(async () =>
      options.preparedSpeakerTrack === false ? undefined : speakerTrack(),
    ),
    getInterruptedProgress: vi.fn(async () =>
      options.interruptedDubbing
        ? {
            assetId: 'video',
            sourceRevision: 'dubbing-revision',
            completedPhrases: 2,
            totalPhrases: 3,
            completedDurationMs: 4_000,
            durationMs: 12_000,
            readySuffixStartMs: 8_000,
            previewAudioPath: join(directory, 'preview.wav'),
            speakerTrack: speakerTrack(),
          }
        : undefined,
    ),
    removeCheckpoint: vi.fn(async () => undefined),
  } as unknown as VoxCpm2DubbingProducer;
  const speakerTrackProducer = {
    materialize: vi.fn(async (_artifacts, request: AssetArtifactRequest) =>
      resolvedArtifact(
        request,
        join(directory, 'speaker-track.json'),
        DUBBING_SPEAKER_TRACK_ARTIFACT_MEDIA_TYPE,
        'speaker-track-artifact-revision',
      ),
    ),
  };
  const requireInstalledBundle = options.installationError
    ? vi.fn(async () => Promise.reject(options.installationError))
    : vi.fn(async () => undefined);
  const dubbingRuntime = {
    requireInstalledBundle,
    requireRuntime: vi.fn(),
    withRuntime: vi.fn(),
    warmup: vi.fn(async () => undefined),
    releaseWarmup: vi.fn(async () => undefined),
    runVoiceJob: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  } as VoxCpm2DubbingRuntimeResolverApi;
  const progress = new MediaDubbingProgressHub();
  const service = new MediaDubbingService(
    assets,
    projects,
    artifacts,
    subtitles,
    producer,
    speakerTrackProducer,
    {} as MediaSubtitleRuntimeResolverApi,
    dubbingRuntime,
    progress,
  );
  return {
    service,
    subtitles,
    producer,
    speakerTrackProducer,
    progress,
    requireInstalledBundle,
    dubbingRuntime,
  };
}

describe('MediaDubbingService', () => {
  it('uses an already-ready translation without requesting translation again', async () => {
    const { service, subtitles, producer, speakerTrackProducer } =
      await createFixture();
    const phases: string[] = [];
    service.subscribe('video', (snapshot) => phases.push(snapshot.phase));

    await service.ensure('project', 'video');

    expect(subtitles.ensureTranslation).not.toHaveBeenCalled();
    expect(phases).not.toContain('awaiting-translation');
    expect(producer.materialize).toHaveBeenCalledOnce();
    expect(producer.removeCheckpoint).toHaveBeenCalledOnce();
    expect(speakerTrackProducer.materialize).toHaveBeenCalledOnce();
    expect(speakerTrackProducer.materialize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        producerId: DUBBING_SPEAKER_TRACK_PRODUCER_ID,
        artifactKey: DUBBING_SPEAKER_TRACK_ARTIFACT_KEY,
        source: expect.objectContaining({
          mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          revision: 'source-artifact-revision',
        }),
      }),
      expect.objectContaining({
        cues: [expect.objectContaining({ id: 'cue-1' })],
      }),
      expect.objectContaining({
        sourceTrackRevision: 'source-artifact-revision',
      }),
    );
    expect(service.getSpeakerTrack('video')).toMatchObject({
      sourceTrackRevision: 'source-artifact-revision',
    });
    expect(service.getSnapshot('video')).toMatchObject({
      phase: 'ready',
      artifactRevision: 'dubbing-artifact-revision',
      durationMs: 4_000,
      readySuffixStartMs: 0,
    });
  });

  it('balances every compatible Workbench consumer in the shared runtime', async () => {
    const { service, dubbingRuntime } = await createFixture();

    service.warmup('video');
    service.warmup('video');
    await vi.waitFor(() =>
      expect(dubbingRuntime.warmup).toHaveBeenCalledTimes(2),
    );
    service.releaseWarmup('video');
    await vi.waitFor(() =>
      expect(dubbingRuntime.releaseWarmup).toHaveBeenCalledOnce(),
    );
    service.releaseWarmup('video');
    await vi.waitFor(() =>
      expect(dubbingRuntime.releaseWarmup).toHaveBeenCalledTimes(2),
    );
  });

  it('requests translation when no translated track is ready', async () => {
    const { service, subtitles, producer } = await createFixture();
    vi.mocked(subtitles.getSnapshot)
      .mockReturnValueOnce({
        phase: 'source-ready',
        source: sourceTrack('video-revision'),
        partialTranslations: [],
        completedCues: 0,
        totalCues: 1,
      })
      .mockReturnValue({
        phase: 'ready',
        source: sourceTrack('video-revision'),
        translation: translationTrack(),
        partialTranslations: [],
        completedCues: 1,
        totalCues: 1,
      });
    const phases: string[] = [];
    service.subscribe('video', (snapshot) => phases.push(snapshot.phase));

    await service.ensure('project', 'video');

    expect(subtitles.ensureTranslation).toHaveBeenCalledOnce();
    expect(subtitles.ensureTranslation).toHaveBeenCalledWith(
      'project',
      'video',
    );
    expect(phases).toContain('awaiting-translation');
    expect(producer.materialize).toHaveBeenCalledOnce();
    expect(service.getSnapshot('video').phase).toBe('ready');
  });

  it('uses an existing dubbing artifact without preparing the model runtime', async () => {
    const { service, producer, speakerTrackProducer } = await createFixture({
      cachedDubbing: true,
    });

    await service.ensure('project', 'video');

    expect(producer.materialize).not.toHaveBeenCalled();
    expect(speakerTrackProducer.materialize).not.toHaveBeenCalled();
    expect(service.getSnapshot('video').phase).toBe('ready');
    expect(service.getSpeakerTrack('video')).toMatchObject({
      sourceTrackRevision: 'source-artifact-revision',
    });
  });

  it('keeps an existing dubbing artifact usable when optional speaker metadata is missing', async () => {
    const { service, producer, speakerTrackProducer } = await createFixture({
      cachedDubbing: true,
      cachedSpeakerTrack: false,
      preparedSpeakerTrack: false,
    });

    await service.ensure('project', 'video');

    expect(producer.materialize).not.toHaveBeenCalled();
    expect(speakerTrackProducer.materialize).not.toHaveBeenCalled();
    expect(service.getSnapshot('video').phase).toBe('ready');
    expect(service.getSpeakerTrack('video')).toBeUndefined();
  });

  it('restores a completed artifact without starting generation', async () => {
    const { service, producer } = await createFixture({ cachedDubbing: true });

    await service.restore('project', 'video');

    expect(producer.materialize).not.toHaveBeenCalled();
    expect(service.getSnapshot('video')).toMatchObject({
      phase: 'ready',
      artifactRevision: 'dubbing-artifact-revision',
      readySuffixStartMs: 0,
    });
  });

  it('recovers a missing speaker artifact from the durable checkpoint after a crash', async () => {
    const { service, producer, speakerTrackProducer } = await createFixture({
      cachedDubbing: true,
      cachedSpeakerTrack: false,
    });

    await service.restore('project', 'video');

    expect(producer.getPreparedSpeakerTrack).toHaveBeenCalledOnce();
    expect(speakerTrackProducer.materialize).toHaveBeenCalledOnce();
    expect(producer.removeCheckpoint).toHaveBeenCalledOnce();
    expect(service.getSpeakerTrack('video')).toMatchObject({
      sourceTrackRevision: 'source-artifact-revision',
    });
    expect(service.getSnapshot('video').phase).toBe('ready');
  });

  it('restores a durable interrupted suffix as a resumable state', async () => {
    const { service, producer } = await createFixture({
      interruptedDubbing: true,
    });

    await service.restore('project', 'video');

    expect(producer.materialize).not.toHaveBeenCalled();
    expect(service.getSnapshot('video')).toMatchObject({
      phase: 'interrupted',
      completedPhrases: 2,
      totalPhrases: 3,
      readySuffixStartMs: 8_000,
      previewAudioPath: expect.stringContaining('preview.wav'),
    });
    expect(service.getSpeakerTrack('video')).toMatchObject({
      sourceTrackRevision: 'source-artifact-revision',
    });
  });

  it('reports the missing dubbing component before starting subtitle translation', async () => {
    const { service, subtitles, producer, requireInstalledBundle } =
      await createFixture({
        installationError: new AppError('EXTERNAL_LIBRARY_NOT_INSTALLED'),
      });

    await service.ensure('project', 'video');

    expect(requireInstalledBundle).toHaveBeenCalledOnce();
    expect(subtitles.ensureTranslation).not.toHaveBeenCalled();
    expect(producer.materialize).not.toHaveBeenCalled();
    expect(service.getSnapshot('video')).toMatchObject({
      phase: 'runtime-required',
      message: '请先在设置中安装 VoxCPM2 视频/音频配音组件。',
    });
  });

  it('reports the missing dubbing component before generation is requested', async () => {
    const { service, subtitles, producer, requireInstalledBundle } =
      await createFixture({
        installationError: new AppError('EXTERNAL_LIBRARY_NOT_INSTALLED'),
      });

    await service.refreshRuntimeAvailability('video');

    expect(requireInstalledBundle).toHaveBeenCalledOnce();
    expect(subtitles.ensureTranslation).not.toHaveBeenCalled();
    expect(producer.materialize).not.toHaveBeenCalled();
    expect(service.getSnapshot('video')).toMatchObject({
      phase: 'runtime-required',
      message: '请先在设置中安装 VoxCPM2 视频/音频配音组件。',
    });
  });

  it.each([
    ['EXTERNAL_LIBRARY_NOT_INSTALLED', 'runtime-required'],
    ['FEATURE_NOT_SUPPORTED', 'unsupported'],
  ] as const)('maps %s into the %s state', async (code, phase) => {
    const { service } = await createFixture({
      materializeError: new AppError(code),
    });

    await service.ensure('project', 'video');

    expect(service.getSnapshot('video').phase).toBe(phase);
  });

  it('keeps the durable checkpoint when generation fails', async () => {
    const { service, producer } = await createFixture({
      materializeError: new Error('worker stopped'),
    });

    await service.ensure('project', 'video');

    expect(service.getSnapshot('video').phase).toBe('failed');
    expect(producer.removeCheckpoint).not.toHaveBeenCalled();
  });

  it('accepts progress only from the active dubbing revision', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<ResolvedAssetArtifact>((resolvePromise) => {
      finish = () =>
        resolvePromise({
          absolutePath: 'C:\\dubbed.m4a',
          cacheHit: false,
          artifact: {
            assetId: 'video',
            producerId: VOXCPM2_DUBBING_PRODUCER_ID,
            artifactKey: 'dubbing.voxcpm2.zh-Hans.quality',
            relativePath: 'artifacts/dubbed.m4a',
            mediaType: VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
            sourceRevision: 'revision',
            producerVersion: '1',
            artifactRevision: 'dubbing-artifact-revision',
            updatedTime: 100,
          },
        });
    });
    const fixture = await createFixture();
    vi.mocked(fixture.producer.materialize).mockReturnValue(pending);
    const running = fixture.service.ensure('project', 'video');
    await vi.waitFor(() =>
      expect(fixture.producer.materialize).toHaveBeenCalledOnce(),
    );
    const request = vi.mocked(fixture.producer.materialize).mock.calls[0]![1];
    const snapshotBeforeStaleProgress =
      fixture.service.getSnapshot('video');
    const speakerEvents: Array<DubbingSpeakerTrackV1 | undefined> = [];
    fixture.service.subscribeSpeakerTrack('video', (track) =>
      speakerEvents.push(track),
    );

    fixture.progress.publish({
      assetId: 'video',
      sourceRevision: 'stale',
      phase: 'cloning',
      completedPhrases: 9,
      totalPhrases: 10,
      completedDurationMs: 9_000,
      durationMs: 10_000,
      readySuffixStartMs: 1_000,
      speakerTrack: speakerTrack(),
    });
    expect(fixture.service.getSnapshot('video')).toEqual(
      snapshotBeforeStaleProgress,
    );
    expect(speakerEvents).toEqual([]);

    fixture.progress.publish({
      assetId: 'video',
      sourceRevision: request.source.revision,
      phase: 'cloning',
      completedPhrases: 2,
      totalPhrases: 10,
      completedDurationMs: 2_000,
      durationMs: 10_000,
      readySuffixStartMs: 8_000,
      previewAudioPath: 'C:\\checkpoint\\preview.wav',
      speakerTrack: speakerTrack(),
    });
    expect(fixture.service.getSnapshot('video')).toMatchObject({
      phase: 'cloning',
      completedPhrases: 2,
      readySuffixStartMs: 8_000,
      previewAudioPath: 'C:\\checkpoint\\preview.wav',
    });
    expect(speakerEvents).toHaveLength(1);
    expect(speakerEvents[0]).toMatchObject({
      sourceTrackRevision: 'source-artifact-revision',
    });

    finish?.();
    await running;
  });
});
