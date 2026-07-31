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
  WorkbenchStateRepository,
} from '../../main/workbench/workbench-state-repository';
import { VideoWorkbenchProvider } from './main';
import {
  createVideoSaveViewStateCommand,
  DEFAULT_VIDEO_VIEW_STATE,
  VIDEO_STATE_SCHEMA_VERSION,
  VIDEO_WORKBENCH_ID,
} from './shared';

class MemoryStateRepository implements WorkbenchStateRepository {
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
    const states = new MemoryStateRepository();
    const provider = new VideoWorkbenchProvider(resources, states);
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
        schemaVersion: VIDEO_STATE_SCHEMA_VERSION,
        payload: { viewState },
        updatedTime: 100,
      },
    });

    await expect(provider.open(context)).resolves.toEqual({
      payload: {
        contentUrl: 'learning-content://resource/video',
        viewState,
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
    const states = new MemoryStateRepository();
    const provider = new VideoWorkbenchProvider(resources, states, {
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
    const provider = new VideoWorkbenchProvider(
      resources,
      new MemoryStateRepository(),
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
      new VideoWorkbenchProvider(
        createResources(),
        new MemoryStateRepository(),
      ).open(unsupported),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });
});
