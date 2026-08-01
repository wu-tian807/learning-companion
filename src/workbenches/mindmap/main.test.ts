import { describe, expect, it, vi } from 'vitest';

import { createAssetSnapshot } from '../../main/assets/asset';
import type { ContentHandle } from '../../main/content/content-handle';
import {
  createAbsoluteLocalFileContentRef,
  createAssetContentStatus,
} from '../../main/content/content-ref';
import type { WorkbenchProviderContext } from '../../main/workbench/workbench-session';
import type {
  WorkbenchStateRecord,
  WorkbenchStateRepository,
} from '../../main/workbench/workbench-state-repository';
import type { MindMapAssociationLookup } from './association-mapper';
import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  type MindMapDocumentV1,
} from './document';
import { MindMapWorkbenchProvider } from './main';
import { encodeMindMapDocument } from './mindmap-content-adapter';
import {
  createMindMapSaveViewStateCommand,
  isMindMapWorkbenchPayload,
  MIND_MAP_MEDIA_TYPE,
  MIND_MAP_STATE_SCHEMA_VERSION,
  MIND_MAP_WORKBENCH_ID,
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

const document: MindMapDocumentV1 = {
  format: MIND_MAP_DOCUMENT_FORMAT,
  version: MIND_MAP_DOCUMENT_VERSION,
  title: '线性规划',
  rootNodeId: 'root',
  nodes: {
    root: {
      id: 'root',
      title: '线性规划',
      focus: '课程总览',
      childIds: ['leaf'],
    },
    leaf: {
      id: 'leaf',
      title: '基本解',
      focus: '核心定义',
      childIds: [],
    },
  },
  frames: {},
  associations: { nodes: {}, frames: {} },
};

const associationLookup: MindMapAssociationLookup = {
  getReference: () => undefined,
  getLink: () => undefined,
};

function createHandle(): ContentHandle & {
  readonly readBytes: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
} {
  return {
    capabilities: new Set(['read-bytes']),
    readBytes: vi.fn(async () => ({
      content: encodeMindMapDocument(document),
      revision: 'revision-1',
    })),
    close: vi.fn(async () => undefined),
  };
}

function createContext(
  options: {
    readonly sessionId?: string;
    readonly state?: WorkbenchStateRecord;
    readonly handle?: ContentHandle;
    readonly selectionReason?: WorkbenchProviderContext['selectionReason'];
  } = {},
): WorkbenchProviderContext {
  const contentRef = createAbsoluteLocalFileContentRef(
    '/tmp/course.mindmap',
  );
  const asset = createAssetSnapshot({
    id: 'mindmap',
    projectId: 'project',
    name: '课程导图',
    mediaType: MIND_MAP_MEDIA_TYPE,
    creationKind: 'generated',
    contentRef,
    createdTime: 100,
    updatedTime: 100,
  });

  return {
    sessionId: options.sessionId ?? 'session',
    asset,
    content: {
      contentRef,
      contentStatus: createAssetContentStatus('available', 100),
      handle: options.handle ?? createHandle(),
    },
    attachments: [],
    state: options.state,
    selectionReason: options.selectionReason ?? 'matched',
  };
}

describe('MindMapWorkbenchProvider', () => {
  it('opens a new document with every branch collapsed by default', async () => {
    const states = new MemoryStateRepository();
    const provider = new MindMapWorkbenchProvider(
      states,
      associationLookup,
    );
    const handle = createHandle();
    const context = createContext({ handle });

    const opened = await provider.open(context);

    expect(isMindMapWorkbenchPayload(opened.payload)).toBe(true);
    expect(opened.payload).toMatchObject({
      document,
      revision: 'revision-1',
      associations: {
        byNode: {},
        byFrame: {},
        staleBindings: [],
      },
      viewState: { collapsedNodeIds: ['root'] },
    });
    expect(handle.readBytes).toHaveBeenCalledOnce();

    await provider.close(context);
    expect(handle.close).not.toHaveBeenCalled();
  });

  it('restores only collapsible nodes from persisted state', async () => {
    const provider = new MindMapWorkbenchProvider(
      new MemoryStateRepository(),
      associationLookup,
    );
    const context = createContext({
      state: {
        assetId: 'mindmap',
        workbenchId: MIND_MAP_WORKBENCH_ID,
        schemaVersion: MIND_MAP_STATE_SCHEMA_VERSION,
        payload: {
          viewState: {
            collapsedNodeIds: ['root', 'leaf', 'removed'],
            viewport: { x: 10, y: -5, zoom: 0.75 },
          },
        },
        updatedTime: 100,
      },
    });

    const opened = await provider.open(context);

    expect(opened.payload).toMatchObject({
      viewState: {
        collapsedNodeIds: ['root'],
        viewport: { x: 10, y: -5, zoom: 0.75 },
      },
    });
  });

  it('replaces the legacy expanded default with the collapsed default', async () => {
    const provider = new MindMapWorkbenchProvider(
      new MemoryStateRepository(),
      associationLookup,
    );
    const context = createContext({
      state: {
        assetId: 'mindmap',
        workbenchId: MIND_MAP_WORKBENCH_ID,
        schemaVersion: 1,
        payload: {
          viewState: {
            collapsedNodeIds: [],
            viewport: { x: 10, y: -5, zoom: 0.75 },
          },
        },
        updatedTime: 100,
      },
    });

    const opened = await provider.open(context);

    expect(opened.payload).toMatchObject({
      viewState: { collapsedNodeIds: ['root'] },
    });
    expect(opened.payload).not.toHaveProperty('viewState.viewport');
  });

  it('persists validated collapsed nodes and viewport state', async () => {
    const states = new MemoryStateRepository();
    const provider = new MindMapWorkbenchProvider(
      states,
      associationLookup,
      { now: () => 300 },
    );
    const context = createContext();
    await provider.open(context);

    await expect(
      provider.command(
        context,
        createMindMapSaveViewStateCommand({
          collapsedNodeIds: ['root'],
          viewport: { x: 20, y: 30, zoom: 1.2 },
        }),
      ),
    ).resolves.toEqual({
      payload: { saved: true, savedTime: 300 },
    });
    await expect(
      states.get('mindmap', MIND_MAP_WORKBENCH_ID),
    ).resolves.toEqual({
      assetId: 'mindmap',
      workbenchId: MIND_MAP_WORKBENCH_ID,
      schemaVersion: MIND_MAP_STATE_SCHEMA_VERSION,
      payload: {
        viewState: {
          collapsedNodeIds: ['root'],
          viewport: { x: 20, y: 30, zoom: 1.2 },
        },
      },
      updatedTime: 300,
    });

    await expect(
      provider.command(
        context,
        createMindMapSaveViewStateCommand({
          collapsedNodeIds: ['leaf'],
        }),
      ),
    ).rejects.toThrow('INVALID_IPC_REQUEST');
  });

  it('rejects invalid open contexts and stale sessions', async () => {
    const provider = new MindMapWorkbenchProvider(
      new MemoryStateRepository(),
      associationLookup,
    );
    const invalid = createContext({
      handle: {
        capabilities: new Set(['read-stream']),
        close: vi.fn(async () => undefined),
      },
    });

    await expect(provider.open(invalid)).rejects.toThrow(
      'DATA_INTEGRITY_ERROR',
    );

    const context = createContext();
    await provider.open(context);
    await provider.close(context);

    await expect(
      provider.command(
        context,
        createMindMapSaveViewStateCommand({ collapsedNodeIds: [] }),
      ),
    ).rejects.toThrow('WORKBENCH_SESSION_NOT_FOUND');
  });
});
