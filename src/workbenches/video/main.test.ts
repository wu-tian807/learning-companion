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
  createVideoSaveViewStateCommand,
  createVideoSetSubtitleModeCommand,
  DEFAULT_VIDEO_VIEW_STATE,
  VIDEO_STATE_SCHEMA_VERSION,
  VIDEO_WORKBENCH_ID,
} from './shared';
import type {
  VideoSubtitleServiceApi,
  VideoSubtitleServiceListener,
} from './subtitles/video-subtitle-service';

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

function createSubtitles(): VideoSubtitleServiceApi {
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
    readonly subtitles?: VideoSubtitleServiceApi;
    readonly events?: WorkbenchEventBusApi;
  } = {},
): VideoWorkbenchProvider {
  return new VideoWorkbenchProvider(resources, states, {
    subtitles: options.subtitles ?? createSubtitles(),
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
        viewState,
        subtitleState: { displayMode: 'off' },
        subtitleSnapshot: {
          phase: 'idle',
          partialTranslations: [],
          completedCues: 0,
          totalCues: 0,
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
      provider.command(
        context,
        createVideoSaveViewStateCommand(viewState),
      ),
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
    const provider = createProvider(
      resources,
      new MemoryStateDatabase(),
    );
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
      createProvider(
        createResources(),
        new MemoryStateDatabase(),
      ).open(unsupported),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });

  it('starts source subtitles on open and translates only for a requested mode', async () => {
    const resources = createResources();
    const states = new MemoryStateDatabase();
    let listener: VideoSubtitleServiceListener | undefined;
    const unsubscribe = vi.fn();
    const subtitles: VideoSubtitleServiceApi = {
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
    const provider = createProvider(
      resources,
      states,
      { now: () => 400, subtitles, events },
    );
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
    await expect(states.get('asset', VIDEO_WORKBENCH_ID)).resolves.toMatchObject({
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
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session',
      type: 'video:subtitle-snapshot',
    }));

    await provider.close(context);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
