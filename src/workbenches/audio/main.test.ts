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
import type { MediaDubbingServiceApi } from '../media-dubbing/media-dubbing-service';
import type { MediaSubtitleServiceApi } from '../media-subtitles/media-subtitle-service';
import { AudioWorkbenchProvider } from './main';
import {
  AUDIO_STATE_SCHEMA_VERSION,
  AUDIO_WORKBENCH_ID,
  audioEventTypes,
  createAudioGetDubbingSnapshotCommand,
  createAudioGetSpeakerTrackCommand,
  createAudioRetryDubbingCommand,
  createAudioSaveViewStateCommand,
  createAudioSetSubtitleModeCommand,
  createAudioStartDubbingCommand,
  DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
  DEFAULT_AUDIO_VIEW_STATE,
} from './shared';

function createDependencies(now?: () => number) {
  const unsubscribeSubtitles = vi.fn();
  const unsubscribeDubbing = vi.fn();
  const unsubscribeSpeakerTrack = vi.fn();
  const subtitles: MediaSubtitleServiceApi = {
    getSnapshot: vi.fn(() => ({
      phase: 'idle' as const,
      partialTranslations: [],
      completedCues: 0,
      totalCues: 0,
    })),
    subscribe: vi.fn(() => unsubscribeSubtitles),
    ensureSource: vi.fn(async () => undefined),
    ensureTranslation: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
  const dubbing: MediaDubbingServiceApi = {
    getSnapshot: vi.fn(() => ({
      phase: 'idle' as const,
      completedPhrases: 0,
      totalPhrases: 0,
      completedDurationMs: 0,
      durationMs: 0,
      readySuffixStartMs: 0,
    })),
    getSpeakerTrack: vi.fn(() => undefined),
    subscribe: vi.fn(() => unsubscribeDubbing),
    subscribeSpeakerTrack: vi.fn(() => unsubscribeSpeakerTrack),
    refreshRuntimeAvailability: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    warmup: vi.fn(),
    releaseWarmup: vi.fn(),
    ensure: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
  const events: WorkbenchEventBusApi = {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  };
  return {
    subtitles,
    dubbing,
    events,
    now,
    unsubscribeSubtitles,
    unsubscribeDubbing,
    unsubscribeSpeakerTrack,
  };
}

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
    register: vi.fn(() => 'learning-content://resource/audio'),
    revokeSession: vi.fn(),
    handle: vi.fn(async () => new Response()),
    dispose: vi.fn(),
  };
}

function createContext(
  options: {
    readonly handle?: ContentHandle;
    readonly mediaType?: string;
    readonly state?: WorkbenchStateRecord;
  } = {},
): WorkbenchProviderContext {
  const contentRef = createAbsoluteLocalFileContentRef('/tmp/lesson.mp3');
  const asset = createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '课程音频',
    mediaType: options.mediaType ?? 'audio/mpeg',
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

describe('AudioWorkbenchProvider', () => {
  it('opens a scoped resource URL and restores persisted state', async () => {
    const resources = createResources();
    const states = new MemoryStateDatabase();
    const dependencies = createDependencies();
    const provider = new AudioWorkbenchProvider(
      resources,
      states,
      dependencies,
    );
    const viewState = {
      currentTime: 42,
      volume: 0.6,
      muted: true,
      playbackRate: 1.5,
    };
    const context = createContext({
      state: {
        assetId: 'asset',
        workbenchId: AUDIO_WORKBENCH_ID,
        schemaVersion: AUDIO_STATE_SCHEMA_VERSION,
        payload: {
          viewState,
          subtitleState: { displayMode: 'source' },
        },
        updatedTime: 100,
      },
    });

    await expect(provider.open(context)).resolves.toEqual({
      payload: {
        contentUrl: 'learning-content://resource/audio',
        viewState,
        subtitleState: { displayMode: 'source' },
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
        speakerTrackSnapshot: {},
      },
    });
    expect(resources.register).toHaveBeenCalledWith(
      'session',
      context.content.handle,
      'audio/mpeg',
    );
    expect(dependencies.subtitles.ensureSource).toHaveBeenCalledWith(
      'project',
      'asset',
    );
    await vi.waitFor(() => {
      expect(dependencies.dubbing.restore).toHaveBeenCalledWith(
        'project',
        'asset',
      );
      expect(dependencies.dubbing.warmup).toHaveBeenCalledWith('asset');
    });
  });

  it('persists validated view state and revokes the session', async () => {
    const resources = createResources();
    const states = new MemoryStateDatabase();
    const dependencies = createDependencies(() => 300);
    const provider = new AudioWorkbenchProvider(
      resources,
      states,
      dependencies,
    );
    const context = createContext();
    const viewState = {
      currentTime: 90,
      volume: 0.4,
      muted: false,
      playbackRate: 2,
    };
    await provider.open(context);

    await expect(
      provider.command(
        context,
        createAudioSaveViewStateCommand(viewState),
      ),
    ).resolves.toEqual({
      payload: { saved: true, savedTime: 300 },
    });
    await expect(
      states.get('asset', AUDIO_WORKBENCH_ID),
    ).resolves.toMatchObject({
      payload: { viewState },
    });

    await provider.close(context);
    expect(resources.revokeSession).toHaveBeenCalledWith('session');
    expect(dependencies.unsubscribeSubtitles).toHaveBeenCalledOnce();
    expect(dependencies.unsubscribeDubbing).toHaveBeenCalledOnce();
    expect(dependencies.unsubscribeSpeakerTrack).toHaveBeenCalledOnce();
    expect(dependencies.dubbing.releaseWarmup).toHaveBeenCalledWith('asset');
  });

  it('migrates version 1 playback state and defaults to source subtitles', async () => {
    const viewState = {
      currentTime: 12,
      volume: 0.5,
      muted: false,
      playbackRate: 1.25,
    };
    const provider = new AudioWorkbenchProvider(
      createResources(),
      new MemoryStateDatabase(),
      createDependencies(),
    );

    await expect(
      provider.open(
        createContext({
          state: {
            assetId: 'asset',
            workbenchId: AUDIO_WORKBENCH_ID,
            schemaVersion: 1,
            payload: { viewState },
            updatedTime: 100,
          },
        }),
      ),
    ).resolves.toMatchObject({
      payload: {
        viewState,
        subtitleState: DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
      },
    });
  });

  it('routes translation and resumable dubbing through media services', async () => {
    const dependencies = createDependencies(() => 400);
    const states = new MemoryStateDatabase();
    const provider = new AudioWorkbenchProvider(
      createResources(),
      states,
      dependencies,
    );
    const context = createContext();
    await provider.open(context);

    await provider.command(
      context,
      createAudioSetSubtitleModeCommand('bilingual'),
    );
    expect(dependencies.subtitles.ensureTranslation).toHaveBeenCalledWith(
      'project',
      'asset',
    );
    await expect(states.get('asset', AUDIO_WORKBENCH_ID)).resolves.toMatchObject({
      schemaVersion: 2,
      payload: { subtitleState: { displayMode: 'bilingual' } },
    });

    await provider.command(context, createAudioStartDubbingCommand());
    await provider.command(context, createAudioRetryDubbingCommand());
    await provider.command(context, createAudioGetDubbingSnapshotCommand());
    await provider.command(context, createAudioGetSpeakerTrackCommand());
    expect(dependencies.dubbing.ensure).toHaveBeenCalledWith('project', 'asset');
    expect(dependencies.dubbing.retry).toHaveBeenCalledWith('project', 'asset');
    expect(dependencies.dubbing.getSnapshot).toHaveBeenCalledWith('asset');
    expect(dependencies.dubbing.getSpeakerTrack).toHaveBeenCalledWith('asset');
  });

  it('publishes only active-session subtitle, dubbing and speaker updates', async () => {
    const dependencies = createDependencies();
    const provider = new AudioWorkbenchProvider(
      createResources(),
      new MemoryStateDatabase(),
      dependencies,
    );
    const context = createContext();
    await provider.open(context);
    const subtitleListener = vi.mocked(dependencies.subtitles.subscribe)
      .mock.calls[0]?.[1];
    const dubbingListener = vi.mocked(dependencies.dubbing.subscribe)
      .mock.calls[0]?.[1];
    const speakerListener = vi.mocked(
      dependencies.dubbing.subscribeSpeakerTrack,
    ).mock.calls[0]?.[1];

    subtitleListener?.({
      type: 'snapshot',
      snapshot: {
        phase: 'transcribing',
        partialTranslations: [],
        completedCues: 0,
        totalCues: 0,
      },
    });
    dubbingListener?.({
      phase: 'cloning',
      completedPhrases: 1,
      totalPhrases: 2,
      completedDurationMs: 1_000,
      durationMs: 2_000,
      readySuffixStartMs: 1_000,
    });
    speakerListener?.({
      version: 1,
      kind: 'dubbing-speaker-track',
      sourceTrackRevision: 'source-track-revision',
      cues: [
        {
          sourceCueId: 'cue-1',
          speakerId: 'speaker-0001',
          status: 'stable',
        },
      ],
      profiles: [{ speakerId: 'speaker-0001', mode: 'default' }],
    });
    expect(dependencies.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session',
        type: audioEventTypes.subtitleSnapshot,
      }),
    );
    expect(dependencies.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session',
        type: audioEventTypes.dubbingSnapshot,
      }),
    );
    expect(dependencies.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session',
        type: audioEventTypes.speakerTrack,
        payload: {
          track: expect.objectContaining({
            sourceTrackRevision: 'source-track-revision',
          }),
        },
      }),
    );

    await provider.close(context);
    vi.mocked(dependencies.events.publish).mockClear();
    subtitleListener?.({
      type: 'snapshot',
      snapshot: {
        phase: 'failed',
        partialTranslations: [],
        completedCues: 0,
        totalCues: 0,
      },
    });
    dubbingListener?.({
      phase: 'failed',
      completedPhrases: 0,
      totalPhrases: 0,
      completedDurationMs: 0,
      durationMs: 0,
      readySuffixStartMs: 0,
    });
    speakerListener?.(undefined);
    expect(dependencies.events.publish).not.toHaveBeenCalled();
  });

  it('falls back from invalid state and rejects unsupported content', async () => {
    const resources = createResources();
    const provider = new AudioWorkbenchProvider(
      resources,
      new MemoryStateDatabase(),
      createDependencies(),
    );
    const invalidState = createContext({
      state: {
        assetId: 'asset',
        workbenchId: AUDIO_WORKBENCH_ID,
        schemaVersion: AUDIO_STATE_SCHEMA_VERSION,
        payload: {
          viewState: { ...DEFAULT_AUDIO_VIEW_STATE, volume: 2 },
        },
        updatedTime: 100,
      },
    });
    await expect(provider.open(invalidState)).resolves.toMatchObject({
      payload: { viewState: DEFAULT_AUDIO_VIEW_STATE },
    });

    const unsupported = createContext({
      mediaType: 'video/mp4',
    });
    await expect(
      new AudioWorkbenchProvider(
        createResources(),
        new MemoryStateDatabase(),
        createDependencies(),
      ).open(unsupported),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });
});
