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
import { PdfWorkbenchProvider } from './main';
import {
  clonePdfWorkbenchState,
  createPdfSaveViewStateCommand,
  DEFAULT_PDF_WORKBENCH_STATE,
  PDF_STATE_SCHEMA_VERSION,
  PDF_WORKBENCH_ID,
  type PdfWorkbenchViewState,
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

function createResourceService() {
  const register = vi.fn<
    ContentResourceServiceApi['register']
  >(() => 'learning-content://resource/pdf-token');
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
    readonly mediaType?: string;
    readonly selectionReason?: WorkbenchProviderContext['selectionReason'];
  } = {},
): WorkbenchProviderContext {
  const contentRef = createAbsoluteLocalFileContentRef('/tmp/learning.pdf');
  const asset = createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '学习资料',
    mediaType: options.mediaType ?? 'application/pdf',
    creationKind: 'imported',
    contentRef,
    createdTime: 100,
    updatedTime: 100,
  });
  const handle =
    options.handle ??
    ({
      capabilities: new Set(['read-stream']),
      openByteStream: vi.fn(async () => ({
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
        byteLength: 0,
      })),
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

describe('PdfWorkbenchProvider', () => {
  it('registers a temporary content URL and opens with default state', async () => {
    const resources = createResourceService();
    const states = new MemoryStateDatabase();
    const provider = new PdfWorkbenchProvider(resources, states);
    const context = createContext();

    await expect(provider.open(context)).resolves.toEqual({
      payload: {
        contentUrl: 'learning-content://resource/pdf-token',
        sourceRevision: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        viewState: DEFAULT_PDF_WORKBENCH_STATE,
      },
    });
    expect(resources.register).toHaveBeenCalledWith(
      'session',
      context.content.handle,
      'application/pdf',
    );
  });

  it('restores valid state and falls back from invalid state', async () => {
    const persisted: PdfWorkbenchViewState = {
      readingMode: 'paged',
      pageNumber: 18,
      pageOffsetRatio: 0.4,
      scaleMode: 'custom',
      customScale: 1.75,
      rotation: 90,
      sidebar: 'outline',
    };
    const resources = createResourceService();
    const states = new MemoryStateDatabase();
    const provider = new PdfWorkbenchProvider(resources, states);

    await expect(
      provider.open(
        createContext({
          sessionId: 'valid',
          state: {
            assetId: 'asset',
            workbenchId: PDF_WORKBENCH_ID,
            schemaVersion: PDF_STATE_SCHEMA_VERSION,
            payload: clonePdfWorkbenchState(persisted),
            updatedTime: 100,
          },
        }),
      ),
    ).resolves.toMatchObject({ payload: { viewState: persisted } });
    await expect(
      provider.open(
        createContext({
          sessionId: 'invalid',
          state: {
            assetId: 'asset',
            workbenchId: PDF_WORKBENCH_ID,
            schemaVersion: PDF_STATE_SCHEMA_VERSION,
            payload: { ...persisted, pageNumber: 0 },
            updatedTime: 100,
          },
        }),
      ),
    ).resolves.toMatchObject({
      payload: { viewState: DEFAULT_PDF_WORKBENCH_STATE },
    });
  });

  it('persists validated PDF view state', async () => {
    const resources = createResourceService();
    const states = new MemoryStateDatabase();
    const provider = new PdfWorkbenchProvider(resources, states, {
      now: () => 300,
    });
    const context = createContext();
    const viewState: PdfWorkbenchViewState = {
      ...DEFAULT_PDF_WORKBENCH_STATE,
      pageNumber: 7,
      scaleMode: 'page-fit',
      rotation: 270,
      sidebar: 'thumbnails',
    };
    await provider.open(context);

    await expect(
      provider.command(
        context,
        createPdfSaveViewStateCommand(viewState),
      ),
    ).resolves.toEqual({
      payload: { saved: true, savedTime: 300 },
    });
    await expect(
      states.get('asset', PDF_WORKBENCH_ID),
    ).resolves.toEqual({
      assetId: 'asset',
      workbenchId: PDF_WORKBENCH_ID,
      schemaVersion: PDF_STATE_SCHEMA_VERSION,
      payload: viewState,
      updatedTime: 300,
    });
  });

  it('rejects non-PDF assets, unavailable content, and invalid commands', async () => {
    const resources = createResourceService();
    const states = new MemoryStateDatabase();
    const provider = new PdfWorkbenchProvider(resources, states);

    await expect(
      provider.open(createContext({ mediaType: 'text/plain' })),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    await expect(
      provider.open(
        createContext({
          handle: {
            capabilities: new Set(['read-bytes']),
            close: vi.fn(async () => undefined),
          },
        }),
      ),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    await expect(
      provider.open(
        createContext({ selectionReason: 'content-unavailable' }),
      ),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');

    const context = createContext({ sessionId: 'commands' });
    await provider.open(context);
    await expect(
      provider.command(context, {
        type: 'pdf:save-view-state',
        payload: {
          viewState: {
            ...DEFAULT_PDF_WORKBENCH_STATE,
            customScale: 0,
          },
        },
      }),
    ).rejects.toThrow('INVALID_IPC_REQUEST');
    await expect(
      provider.command(context, { type: 'pdf:unknown' }),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');
  });

  it('prevents duplicate sessions and revokes the URL exactly once', async () => {
    const resources = createResourceService();
    const states = new MemoryStateDatabase();
    const provider = new PdfWorkbenchProvider(resources, states);
    const context = createContext();
    await provider.open(context);

    await expect(provider.open(context)).rejects.toThrow(
      'REGISTRATION_CONFLICT',
    );
    await provider.close(context);
    await provider.close(context);

    expect(resources.revokeSession).toHaveBeenCalledOnce();
    expect(resources.revokeSession).toHaveBeenCalledWith('session');
  });
});
