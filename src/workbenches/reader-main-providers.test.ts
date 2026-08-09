import { describe, expect, it, vi } from 'vitest';

import { createAssetSnapshot } from '../main/assets/asset';
import type { ContentResourceServiceApi } from '../main/content/content-resource-service';
import {
  createAssetContentStatus,
  createAbsoluteLocalFileContentRef,
} from '../main/content/content-ref';
import type {
  MainWorkbenchProvider,
  WorkbenchProviderContext,
} from '../main/workbench/workbench-session';
import type {
  WorkbenchStateRecord,
  WorkbenchStateDatabaseApi,
} from '../main/workbench/workbench-state-database';
import type { WorkbenchStateDataDatabaseApi } from '../main/workbench/workbench-state-data-database';
import { EpubWorkbenchProvider } from './epub/main';
import {
  createEpubSaveViewStateCommand,
  DEFAULT_EPUB_VIEW_STATE,
  EPUB_WORKBENCH_ID,
} from './epub/shared';
import { HtmlWorkbenchProvider } from './html/main';
import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
} from '../shared/workbench/facilities/core-facilities';

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

function createEmptyStateDataDatabase(): WorkbenchStateDataDatabaseApi {
  return {
    async get() {
      return undefined;
    },
    async save() {
      // HTML provider 测试不涉及对话持久化。
    },
    async delete() {
      // no-op
    },
  };
}

function createResources(): ContentResourceServiceApi {
  return {
    register: vi.fn((sessionId) =>
      `learning-content://resource/${sessionId}`,
    ),
    revokeSession: vi.fn(),
    handle: vi.fn(async () => new Response()),
    dispose: vi.fn(),
  };
}

function createContext(
  mediaType: string,
  extension: string,
): WorkbenchProviderContext {
  const contentRef = createAbsoluteLocalFileContentRef(`/tmp/asset.${extension}`);
  const asset = createAssetSnapshot({
    id: `asset-${extension}`,
    projectId: 'project',
    name: '阅读资料',
    mediaType,
    creationKind: 'imported',
    contentRef,
    createdTime: 100,
    updatedTime: 100,
  });

  return {
    sessionId: `session-${extension}`,
    asset,
    content: {
      contentRef,
      contentStatus: createAssetContentStatus('available', 100),
      handle: {
        capabilities: new Set(['read-stream']),
        openByteStream: vi.fn(),
        close: vi.fn(async () => undefined),
      },
    },
    attachments: [],
    state: undefined,
    selectionReason: 'matched',
  };
}

async function verifyProvider(
  provider: MainWorkbenchProvider,
  context: WorkbenchProviderContext,
  resources: ContentResourceServiceApi,
  states: MemoryStateDatabase,
  workbenchId: string,
  command: Parameters<MainWorkbenchProvider['command']>[1],
) {
  const opened = await provider.open(context);

  expect(opened.payload).toMatchObject({
    contentUrl: `learning-content://resource/${context.sessionId}`,
  });
  expect(resources.register).toHaveBeenCalledWith(
    context.sessionId,
    context.content.handle,
    context.asset.mediaType,
  );
  await expect(provider.command(context, command)).resolves.toEqual({
    payload: { saved: true, savedTime: 500 },
  });
  expect(
    states.records.get(`${context.asset.id}:${workbenchId}`),
  ).toMatchObject({
    assetId: context.asset.id,
    workbenchId,
  });

  await provider.close(context);
  expect(resources.revokeSession).toHaveBeenCalledWith(context.sessionId);
}

describe('stream reader main providers', () => {
  it('opens and closes the isolated original HTML provider', async () => {
    const resources = createResources();
    const provider = new HtmlWorkbenchProvider(
      resources,
      createEmptyStateDataDatabase(),
    );
    const context = createContext('text/html', 'html');

    await expect(provider.open(context)).resolves.toEqual({
      payload: {
        contentUrl: `learning-content://resource/${context.sessionId}`,
      },
      transportBindings: [
        {
          transportId:
            CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
          transportVersion: 1,
          facilities: [
            {
              id: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
              version: 1,
            },
            {
              id: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
              version: 1,
            },
          ],
          payload: {
            rootUrl: `learning-content://resource/${context.sessionId}`,
          },
        },
      ],
    });
    expect(resources.register).toHaveBeenCalledWith(
      context.sessionId,
      context.content.handle,
      'text/html',
    );
    await expect(
      provider.command(context, {
        type: 'html:legacy-reader-state',
        payload: {},
      }),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');

    await provider.close(context);
    expect(resources.revokeSession).toHaveBeenCalledWith(
      context.sessionId,
    );
  });

  it('opens, persists and closes the EPUB provider', async () => {
    const resources = createResources();
    const states = new MemoryStateDatabase();
    const provider = new EpubWorkbenchProvider(resources, states, {
      now: () => 500,
    });

    await verifyProvider(
      provider,
      createContext('application/epub+zip', 'epub'),
      resources,
      states,
      EPUB_WORKBENCH_ID,
      createEpubSaveViewStateCommand({
        ...DEFAULT_EPUB_VIEW_STATE,
        location: 'epubcfi(/6/2!/4/2/1:0)',
      }),
    );
  });

  it('rejects mismatched media before exposing a resource URL', async () => {
    const resources = createResources();
    const provider = new HtmlWorkbenchProvider(
      resources,
      createEmptyStateDataDatabase(),
    );

    await expect(
      provider.open(createContext('text/plain', 'txt')),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    expect(resources.register).not.toHaveBeenCalled();
  });
});
