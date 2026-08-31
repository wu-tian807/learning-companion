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
import { AudioWorkbenchProvider } from './main';
import {
  AUDIO_STATE_SCHEMA_VERSION,
  AUDIO_WORKBENCH_ID,
  createAudioSaveViewStateCommand,
  DEFAULT_AUDIO_VIEW_STATE,
} from './shared';

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
    const provider = new AudioWorkbenchProvider(resources, states);
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
        payload: { viewState },
        updatedTime: 100,
      },
    });

    await expect(provider.open(context)).resolves.toEqual({
      payload: {
        contentUrl: 'learning-content://resource/audio',
        viewState,
      },
    });
    expect(resources.register).toHaveBeenCalledWith(
      'session',
      context.content.handle,
      'audio/mpeg',
    );
  });

  it('persists validated view state and revokes the session', async () => {
    const resources = createResources();
    const states = new MemoryStateDatabase();
    const provider = new AudioWorkbenchProvider(resources, states, {
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
  });

  it('falls back from invalid state and rejects unsupported content', async () => {
    const resources = createResources();
    const provider = new AudioWorkbenchProvider(
      resources,
      new MemoryStateDatabase(),
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
      ).open(unsupported),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });
});
