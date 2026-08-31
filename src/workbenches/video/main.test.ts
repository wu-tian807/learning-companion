import { describe, expect, it, vi } from 'vitest';

import { createAssetSnapshot } from '../../main/assets/asset';
import type { ContentHandle } from '../../main/content/content-handle';
import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import {
  createAssetContentStatus,
  createAbsoluteLocalFileContentRef,
} from '../../main/content/content-ref';
import type { WorkbenchProviderContext } from '../../main/workbench/workbench-session';
import type {
  WorkbenchStateRecord,
  WorkbenchStateDatabaseApi,
} from '../../main/workbench/workbench-state-database';
import type { WorkbenchEventBusApi } from '../../main/workbench/workbench-event-bus';
import { VideoWorkbenchProvider } from './main';
import {
  createVideoGetSubtitleSnapshotCommand,
  createVideoGetDubbingSnapshotCommand,
  createVideoRetryDubbingCommand,
  createVideoSaveViewStateCommand,
  createVideoSetSubtitleModeCommand,
  createVideoStartDubbingCommand,
  DEFAULT_VIDEO_VIEW_STATE,
  VIDEO_STATE_SCHEMA_VERSION,
  VIDEO_WORKBENCH_ID,
} from './shared';
import type {
  MediaSubtitleServiceApi,
  MediaSubtitleServiceListener,
} from '../media-subtitles/media-subtitle-service';
import type { MediaDubbingServiceApi } from '../media-dubbing/media-dubbing-service';

class MemoryStateDatabase implements WorkbenchStateDatabaseApi {
  readonly records = new Map<string, WorkbenchStateRecord>();

  async get(assetId: string, workbenchId: string) {
    return this.records.get(`${assetId}:${workbenchId}`);
  }

  async save(record: WorkbenchStateRecord) {
    this.records.set(`${record.assetId}:${record.workbenchId}`, record);
  }

  async delete(assetId: string, workbenchId: string) {
    this.records.delete(`${assetId}:${workbenchId}`);
  }
}

function createResources(): ContentResourceServiceApi {
  return {
    register: vi.fn(() => 'learning-content://resource/video'),
    revokeSession: vi.fn(),
    handle: vi.fn(async () => new Response()),
    dispose: vi.fn(),
  };
}

function createSubtitles(): MediaSubtitleServiceApi {
  return {
    getSnapshot: vi.fn(() => ({
      phase: 'idle' as const,
      partialTranslations: [],
      completedCues: 0,
      totalCues: 0,
    })),
    subscribe: vi.fn(() => () => undefined),
    ensureSource: vi.fn(async () => undefined),
    ensureTranslation: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
}

function createDubbing(): MediaDubbingServiceApi {
  return {
    getSnapshot: vi.fn(() => ({
      phase: 'idle' as const,
      completedPhrases: 0,
      totalPhrases: 0,
      completedDurationMs: 0,
      durationMs: 0,
      readySuffixStartMs: 0,
    })),
    getSpeakerTrack: vi.fn(() => undefined),
    subscribe: vi.fn(() => () => undefined),
    subscribeSpeakerTrack: vi.fn(() => () => undefined),
    refreshRuntimeAvailability: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    warmup: vi.fn(),
    releaseWarmup: vi.fn(),
    ensure: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
}

function createEvents(): WorkbenchEventBusApi {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  };
}

function createProvider(
  resources: ContentResourceServiceApi,
  states: WorkbenchStateDatabaseApi,
  options: {
    readonly now?: () => number;
    readonly subtitles?: MediaSubtitleServiceApi;
    readonly dubbing?: MediaDubbingServiceApi;
    readonly events?: WorkbenchEventBusApi;
  } = {},
): VideoWorkbenchProvider {
  return new VideoWorkbenchProvider(resources, states, {
    subtitles: options.subtitles ?? createSubtitles(),
    dubbing: options.dubbing ?? createDubbing(),
    events: options.events ?? createEvents(),
    now: options.now,
  });
}

function createContext(
  options: {
    readonly handle?: ContentHandle;
    readonly mediaType?: string;
    readonly state?: WorkbenchStateRecord;
  } = {},
): WorkbenchProviderContext {
  const contentRef = createAbsoluteLocalFileContentRef('/tmp/lesson.mp4');
  const asset = createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '课程视频',
    mediaType: options.mediaType ?? 'video/mp4',
    creationKind: 'imported',
    contentRef,
    createdTime: 100,
    updatedTime: 100,
  });

  return {
    sessionId: 'session',
    asset,
    content: {
      contentRef,
      contentStatus: createAssetContentStatus('available', 100),
      observedUpdatedTime: 100,
      handle:
        options.handle ??
        ({
          capabilities: new Set(['read-stream']),
          openByteStream: vi.fn(),
          close: vi.fn(async () => undefined),
        } satisfies ContentHandle),
    },
    attachments: [],
    state: options.state,
    selectionReason: 'matched',
  };
}

describe('VideoWorkbenchProvider', () => {
  it('opens a scoped resource URL and restores persisted state', async () => {
    const resources = createResources();
    const states = new MemoryStateDatabase();
    const provider = createProvider(resources, states);
    const viewState = {
      currentTime: 42,
      volume: 0.6,
      muted: true,
      playbackRate: 1.5,
    };
    const context = createContext({
      state: {
        assetId: 'asset',
        workbenchId: VIDEO_WORKBENCH_ID,
        schemaVersion: 1,
        payload: { viewState },
        updatedTime: 100,
      },
    });

    await expect(provider.open(context)).resolves.toEqual({
      payload: {
        contentUrl: 'learning-content://resource/video',
        sourceRevision: '100',
        viewState,
        subtitleState: { displayMode: 'off' },
        subtitleSnapshot: {
          phase: 'idle',
          partialTranslations: [],
          completedCues: 0,
          totalCues: 0,
        },
        dubbingSnapshot: {
          phase: 'idle',
          completedPhrases: 0,
          totalPhrases: 0,
          completedDurationMs: 0,
          durationMs: 0,
          readySuffixStartMs: 0,
        },
      },
    });
    expect(resources.register).toHaveBeenCalledWith(
      'session',
      context.content.handle,
      'video/mp4',
    );
  });

  it('persists validated view state and revokes the session', async () => {
    const resources = createResources();
    const states = new MemoryStateDatabase();
    const provider = createProvider(resources, states, {
      now: () => 300,
    });
    const context = createContext();
    const viewState = {
      currentTime: 90,
      volume: 0.4,
      muted: false,
      playbackRate: 2,
    };
    await provider.open(context);

    await expect(
      provider.command(context, createVideoSaveViewStateCommand(viewState)),
    ).resolves.toEqual({
      payload: { saved: true, savedTime: 300 },
    });
    await expect(
      states.get('asset', VIDEO_WORKBENCH_ID),
    ).resolves.toMatchObject({
      payload: { viewState },
    });

    await provider.close(context);
    expect(resources.revokeSession).toHaveBeenCalledWith('session');
  });

  it('falls back from invalid state and rejects unsupported content', async () => {
    const resources = createResources();
    const provider = createProvider(resources, new MemoryStateDatabase());
    const invalidState = createContext({
      state: {
        assetId: 'asset',
        workbenchId: VIDEO_WORKBENCH_ID,
        schemaVersion: VIDEO_STATE_SCHEMA_VERSION,
        payload: {
          viewState: { ...DEFAULT_VIDEO_VIEW_STATE, volume: 2 },
        },
        updatedTime: 100,
      },
    });
    await expect(provider.open(invalidState)).resolves.toMatchObject({
      payload: { viewState: DEFAULT_VIDEO_VIEW_STATE },
    });

    const unsupported = createContext({
      mediaType: 'audio/mp4',
    });
    await expect(
      createProvider(createResources(), new MemoryStateDatabase()).open(
        unsupported,
      ),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });

  it('starts source subtitles on open and translates only for a requested mode', async () => {
    const resources = createResources();
    const states = new MemoryStateDatabase();
    let listener: MediaSubtitleServiceListener | undefined;
    const unsubscribe = vi.fn();
    const subtitles: MediaSubtitleServiceApi = {
      getSnapshot: vi.fn(() => ({
        phase: 'idle' as const,
        partialTranslations: [],
        completedCues: 0,
        totalCues: 0,
      })),
      subscribe: vi.fn((_assetId, nextListener) => {
        listener = nextListener;
        return unsubscribe;
      }),
      ensureSource: vi.fn(async () => undefined),
      ensureTranslation: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
    };
    const events: WorkbenchEventBusApi = {
      publish: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    };
    const provider = createProvider(resources, states, {
      now: () => 400,
      subtitles,
      events,
    });
    const context = createContext();

    await provider.open(context);
    expect(subtitles.ensureSource).toHaveBeenCalledWith('project', 'asset');
    expect(subtitles.ensureTranslation).not.toHaveBeenCalled();

    await provider.command(
      context,
      createVideoSetSubtitleModeCommand('source'),
    );
    expect(subtitles.ensureTranslation).not.toHaveBeenCalled();

    await provider.command(
      context,
      createVideoSetSubtitleModeCommand('bilingual'),
    );
    expect(subtitles.ensureTranslation).toHaveBeenCalledOnce();
    await expect(
      states.get('asset', VIDEO_WORKBENCH_ID),
    ).resolves.toMatchObject({
      schemaVersion: 2,
      payload: { subtitleState: { displayMode: 'bilingual' } },
    });

    listener?.({
      type: 'snapshot',
      snapshot: {
        phase: 'transcribing',
        partialTranslations: [],
        completedCues: 0,
        totalCues: 0,
      },
    });
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session',
        type: 'video:subtitle-snapshot',
      }),
    );

    await provider.close(context);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('returns the current subtitle snapshot after a first-open event was missed', async () => {
    const queued = {
      phase: 'queued' as const,
      partialTranslations: [],
      completedCues: 0,
      totalCues: 0,
    };
    const ready = {
      phase: 'source-ready' as const,
      source: {
        version: 1 as const,
        kind: 'subtitle-source' as const,
        sourceRevision: '100',
        language: 'zh-Hans' as const,
        origin: 'asr' as const,
        engine: {
          id: 'sense-voice',
          version: '1',
          model: 'small',
          backend: 'cpu' as const,
        },
        generatedTime: 200,
        cues: [
          {
            id: 'cue-1',
            startMs: 0,
            endMs: 1_000,
            text: '第一句字幕',
            sourceCueIds: ['raw-1'],
          },
        ],
      },
      partialTranslations: [],
      completedCues: 0,
      totalCues: 0,
    };
    const subtitles = createSubtitles();
    vi.mocked(subtitles.getSnapshot)
      .mockReturnValueOnce(queued)
      .mockReturnValue(ready);
    const provider = createProvider(
      createResources(),
      new MemoryStateDatabase(),
      { subtitles },
    );
    const context = createContext();

    await expect(provider.open(context)).resolves.toMatchObject({
      payload: { subtitleSnapshot: queued },
    });
    await expect(
      provider.command(context, createVideoGetSubtitleSnapshotCommand()),
    ).resolves.toEqual({ payload: ready });
  });

  it('starts, retries and reconciles video dubbing through Workbench commands', async () => {
    const dubbing = createDubbing();
    vi.mocked(dubbing.getSnapshot).mockReturnValue({
      phase: 'cloning',
      completedPhrases: 2,
      totalPhrases: 5,
      completedDurationMs: 4_000,
      durationMs: 12_000,
      readySuffixStartMs: 8_000,
    });
    const provider = createProvider(
      createResources(),
      new MemoryStateDatabase(),
      { dubbing },
    );
    const context = createContext();
    await provider.open(context);

    await expect(
      provider.command(context, createVideoStartDubbingCommand()),
    ).resolves.toEqual({ payload: { started: true } });
    await expect(
      provider.command(context, createVideoRetryDubbingCommand()),
    ).resolves.toEqual({ payload: { started: true } });
    await expect(
      provider.command(context, createVideoGetDubbingSnapshotCommand()),
    ).resolves.toEqual({
      payload: {
        phase: 'cloning',
        completedPhrases: 2,
        totalPhrases: 5,
        completedDurationMs: 4_000,
        durationMs: 12_000,
        readySuffixStartMs: 8_000,
      },
    });
    expect(dubbing.ensure).toHaveBeenCalledWith('project', 'asset');
    expect(dubbing.retry).toHaveBeenCalledWith('project', 'asset');
  });

  it('shows the install action on first open when the dubbing runtime is missing', async () => {
    const dubbing = createDubbing();
    vi.mocked(dubbing.refreshRuntimeAvailability).mockImplementation(
      async () => {
        vi.mocked(dubbing.getSnapshot).mockReturnValue({
          phase: 'runtime-required',
          completedPhrases: 0,
          totalPhrases: 0,
          completedDurationMs: 0,
          durationMs: 0,
          readySuffixStartMs: 0,
          message: '请先在设置中安装 VoxCPM2 视频配音组件。',
        });
      },
    );
    const provider = createProvider(
      createResources(),
      new MemoryStateDatabase(),
      { dubbing },
    );

    await expect(provider.open(createContext())).resolves.toMatchObject({
      payload: {
        dubbingSnapshot: {
          phase: 'runtime-required',
          message: '请先在设置中安装 VoxCPM2 视频配音组件。',
        },
      },
    });
    expect(dubbing.refreshRuntimeAvailability).toHaveBeenCalledWith('asset');
    expect(dubbing.ensure).not.toHaveBeenCalled();
  });

  it('publishes a scoped audio URL for a completed dubbing artifact', async () => {
    let listener:
      | ((snapshot: ReturnType<MediaDubbingServiceApi['getSnapshot']>) => void)
      | undefined;
    const unsubscribe = vi.fn();
    const dubbing = createDubbing();
    vi.mocked(dubbing.subscribe).mockImplementation(
      (_assetId, nextListener) => {
        listener = nextListener;
        return unsubscribe;
      },
    );
    const resources = createResources();
    vi.mocked(resources.register)
      .mockReturnValueOnce('learning-content://resource/video')
      .mockReturnValueOnce('learning-content://resource/dubbing');
    const events = createEvents();
    const provider = createProvider(resources, new MemoryStateDatabase(), {
      dubbing,
      events,
    });
    const context = createContext();
    await provider.open(context);

    listener?.({
      phase: 'ready',
      completedPhrases: 5,
      totalPhrases: 5,
      completedDurationMs: 12_000,
      durationMs: 12_000,
      readySuffixStartMs: 0,
      artifactPath: 'C:\\private\\dubbed.m4a',
      artifactRevision: 'dubbed-revision',
    });

    expect(events.publish).toHaveBeenCalledWith({
      sessionId: 'session',
      type: 'video:dubbing-snapshot',
      payload: {
        phase: 'ready',
        completedPhrases: 5,
        totalPhrases: 5,
        completedDurationMs: 12_000,
        durationMs: 12_000,
        readySuffixStartMs: 0,
        audioUrl: 'learning-content://resource/dubbing',
      },
    });
    expect(JSON.stringify(vi.mocked(events.publish).mock.calls)).not.toContain(
      'C:\\\\private',
    );

    await provider.close(context);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(dubbing.warmup).toHaveBeenCalledWith('asset');
    expect(dubbing.restore).toHaveBeenCalledWith('project', 'asset');
    expect(dubbing.releaseWarmup).toHaveBeenCalledWith('asset');
  });

  it('does not warm the model when a completed dubbing artifact is restored', async () => {
    const dubbing = createDubbing();
    vi.mocked(dubbing.getSnapshot).mockReturnValue({
      phase: 'ready',
      completedPhrases: 5,
      totalPhrases: 5,
      completedDurationMs: 12_000,
      durationMs: 12_000,
      readySuffixStartMs: 0,
    });
    const provider = createProvider(
      createResources(),
      new MemoryStateDatabase(),
      { dubbing },
    );
    const context = createContext();

    await provider.open(context);
    await vi.waitFor(() => expect(dubbing.restore).toHaveBeenCalledOnce());

    expect(dubbing.warmup).not.toHaveBeenCalled();
    await provider.close(context);
    expect(dubbing.releaseWarmup).not.toHaveBeenCalled();
  });

  it('publishes one playable mixed resource for each continuous suffix', async () => {
    let listener:
      | ((snapshot: ReturnType<MediaDubbingServiceApi['getSnapshot']>) => void)
      | undefined;
    const dubbing = createDubbing();
    vi.mocked(dubbing.subscribe).mockImplementation(
      (_assetId, nextListener) => {
        listener = nextListener;
        return () => undefined;
      },
    );
    const resources = createResources();
    vi.mocked(resources.register)
      .mockReturnValueOnce('learning-content://resource/video')
      .mockReturnValueOnce('learning-content://resource/preview');
    const events = createEvents();
    const provider = createProvider(resources, new MemoryStateDatabase(), {
      dubbing,
      events,
    });
    const context = createContext();
    await provider.open(context);

    listener?.({
      phase: 'cloning',
      completedPhrases: 2,
      totalPhrases: 5,
      completedDurationMs: 4_000,
      durationMs: 12_000,
      readySuffixStartMs: 8_000,
      previewAudioPath: 'C:\\private\\preview.wav',
    });

    expect(events.publish).toHaveBeenCalledWith({
      sessionId: 'session',
      type: 'video:dubbing-snapshot',
      payload: {
        phase: 'cloning',
        completedPhrases: 2,
        totalPhrases: 5,
        completedDurationMs: 4_000,
        durationMs: 12_000,
        readySuffixStartMs: 8_000,
        previewAudioUrl: 'learning-content://resource/preview',
      },
    });
    expect(JSON.stringify(vi.mocked(events.publish).mock.calls)).not.toContain(
      'C:\\\\private',
    );
  });
});
