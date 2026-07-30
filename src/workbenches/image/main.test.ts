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
import {
  cloneImageViewState,
  createImageSaveViewStateCommand,
  DEFAULT_IMAGE_VIEW_STATE,
  IMAGE_STATE_SCHEMA_VERSION,
  IMAGE_WORKBENCH_ID,
  isImageWorkbenchPayload,
  type ImageWorkbenchViewState,
} from './shared';
import { ImageWorkbenchProvider } from './main';

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

function createResourceService() {
  const register = vi.fn<
    ContentResourceServiceApi['register']
  >(() => 'learning-content://resource/token');
  const revokeSession = vi.fn<
    ContentResourceServiceApi['revokeSession']
  >();

  return {
    register,
    revokeSession,
    handle: vi.fn(async () => new Response()),
    dispose: vi.fn(),
  } satisfies ContentResourceServiceApi;
}

function createContext(
  options: {
    readonly sessionId?: string;
    readonly state?: WorkbenchStateRecord;
    readonly handle?: ContentHandle;
    readonly selectionReason?: WorkbenchProviderContext['selectionReason'];
  } = {},
): WorkbenchProviderContext {
  const contentRef = createAbsoluteLocalFileContentRef('/tmp/diagram.png');
  const asset = createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '架构图',
    mediaType: 'image/png',
    contentRef,
    createdTime: 100,
    lastUsedTime: 100,
  });
  const handle =
    options.handle ??
    ({
      capabilities: new Set(['read-stream']),
      openByteStream: vi.fn(),
      close: vi.fn(async () => undefined),
    } satisfies ContentHandle);

  return {
    sessionId: options.sessionId ?? 'session',
    asset,
    content: {
      contentRef,
      contentStatus: createAssetContentStatus('available', 100),
      handle,
    },
    attachments: [],
    state: options.state,
    selectionReason: options.selectionReason ?? 'matched',
  };
}

describe('ImageWorkbenchProvider', () => {
  it('registers a resource URL and opens with the default view state', async () => {
    const resources = createResourceService();
    const states = new MemoryStateRepository();
    const provider = new ImageWorkbenchProvider(resources, states);
    const context = createContext();

    const opened = await provider.open(context);

    expect(isImageWorkbenchPayload(opened.payload)).toBe(true);
    expect(opened.payload).toEqual({
      contentUrl: 'learning-content://resource/token',
      viewState: DEFAULT_IMAGE_VIEW_STATE,
    });
    expect(resources.register).toHaveBeenCalledWith(
      'session',
      context.content.handle,
      'image/png',
    );
  });

  it('restores valid state and falls back from invalid state', async () => {
    const persistedViewState: ImageWorkbenchViewState = {
      mode: 'manual',
      centerX: 0.25,
      centerY: 0.75,
      scale: 2,
      rotation: 90,
    };
    const resources = createResourceService();
    const states = new MemoryStateRepository();
    const provider = new ImageWorkbenchProvider(resources, states);
    const valid = createContext({
      sessionId: 'valid',
      state: {
        assetId: 'asset',
        workbenchId: IMAGE_WORKBENCH_ID,
        schemaVersion: IMAGE_STATE_SCHEMA_VERSION,
        payload: { viewState: cloneImageViewState(persistedViewState) },
        updatedTime: 100,
      },
    });
    const invalid = createContext({
      sessionId: 'invalid',
      state: {
        assetId: 'asset',
        workbenchId: IMAGE_WORKBENCH_ID,
        schemaVersion: IMAGE_STATE_SCHEMA_VERSION,
        payload: {
          viewState: { ...persistedViewState, rotation: 45 },
        },
        updatedTime: 100,
      },
    });

    await expect(provider.open(valid)).resolves.toMatchObject({
      payload: { viewState: persistedViewState },
    });
    await expect(provider.open(invalid)).resolves.toMatchObject({
      payload: { viewState: DEFAULT_IMAGE_VIEW_STATE },
    });
  });

  it('persists validated view state commands', async () => {
    const resources = createResourceService();
    const states = new MemoryStateRepository();
    const provider = new ImageWorkbenchProvider(resources, states, {
      now: () => 300,
    });
    const context = createContext();
    const viewState: ImageWorkbenchViewState = {
      mode: 'actual-size',
      centerX: 0.4,
      centerY: 0.6,
      scale: 1,
      rotation: 270,
    };
    await provider.open(context);

    await expect(
      provider.command(
        context,
        createImageSaveViewStateCommand(viewState),
      ),
    ).resolves.toEqual({
      payload: { saved: true, savedTime: 300 },
    });
    await expect(
      states.get('asset', IMAGE_WORKBENCH_ID),
    ).resolves.toEqual({
      assetId: 'asset',
      workbenchId: IMAGE_WORKBENCH_ID,
      schemaVersion: IMAGE_STATE_SCHEMA_VERSION,
      payload: { viewState },
      updatedTime: 300,
    });
  });

  it('rejects invalid open contexts and command payloads', async () => {
    const resources = createResourceService();
    const states = new MemoryStateRepository();
    const provider = new ImageWorkbenchProvider(resources, states);
    const missingCapability = createContext({
      handle: {
        capabilities: new Set(['read-bytes']),
        close: vi.fn(async () => undefined),
      },
    });

    await expect(provider.open(missingCapability)).rejects.toThrow(
      'DATA_INTEGRITY_ERROR',
    );

    const context = createContext();
    await provider.open(context);
    await expect(
      provider.command(context, {
        type: 'image:save-view-state',
        payload: { viewState: { scale: 0 } },
      }),
    ).rejects.toThrow('INVALID_IPC_REQUEST');
    await expect(
      provider.command(context, { type: 'image:unknown' }),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');
  });

  it('revokes the temporary URL when the session closes', async () => {
    const resources = createResourceService();
    const states = new MemoryStateRepository();
    const provider = new ImageWorkbenchProvider(resources, states);
    const context = createContext();
    await provider.open(context);

    await provider.close(context);
    await provider.close(context);

    expect(resources.revokeSession).toHaveBeenCalledOnce();
    expect(resources.revokeSession).toHaveBeenLastCalledWith('session');
  });
});
