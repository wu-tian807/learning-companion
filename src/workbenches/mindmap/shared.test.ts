import { describe, expect, it } from 'vitest';

import { isAssetWorkbenchManifest } from '../../shared/workbench/manifest';
import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  MIND_MAP_DOCUMENT_VERSION_V2,
  MIND_MAP_DOCUMENT_VERSION_V3,
  type MindMapDocumentV1,
  type MindMapDocumentV2,
  type MindMapDocumentV3,
} from './document';
import {
  cloneMindMapWorkbenchViewState,
  createMindMapFrameTarget,
  createMindMapNodeTarget,
  createMindMapSaveViewStateCommand,
  isMindMapWorkbenchPayload,
  isMindMapWorkbenchViewState,
  isMindMapFrameTarget,
  isMindMapNodeTarget,
  mindMapWorkbenchManifest,
} from './shared';

const document: MindMapDocumentV1 = {
  format: MIND_MAP_DOCUMENT_FORMAT,
  version: MIND_MAP_DOCUMENT_VERSION,
  title: 'Map',
  rootNodeId: 'root',
  nodes: {
    root: {
      id: 'root',
      title: 'Root',
      focus: 'Root topic',
      childIds: [],
    },
  },
  frames: {},
  associations: { nodes: {}, frames: {} },
};

const documentV2: MindMapDocumentV2 = {
  ...document,
  version: MIND_MAP_DOCUMENT_VERSION_V2,
  associations: {
    nodes: {
      root: {
        references: [
          {
            referenceId: 'reference-source',
            sourceRevision: 'source-revision-1',
            agentLocator: { heading: 'Introduction' },
          },
        ],
        linkIds: [],
      },
    },
    frames: {},
  },
};

const documentV3: MindMapDocumentV3 = {
  ...document,
  version: MIND_MAP_DOCUMENT_VERSION_V3,
  associations: {
    nodes: {
      root: {
        references: [
          {
            referenceId: 'reference-source',
            sourceRevision: 'source-revision-1',
            target: { scope: 'asset' },
          },
        ],
        linkIds: [],
      },
    },
    frames: {},
  },
};

describe('Mind Map interaction targets', () => {
  it('creates stable Node and Frame Targets', () => {
    const nodeTarget = createMindMapNodeTarget('basic-solution');
    const frameTarget = createMindMapFrameTarget('foundations');

    expect(isMindMapNodeTarget(nodeTarget)).toBe(true);
    expect(nodeTarget).toEqual({
      scope: 'content',
      targetType: 'mindmap.node',
      targetVersion: 1,
      targetPayload: { nodeId: 'basic-solution' },
    });
    expect(isMindMapFrameTarget(frameTarget)).toBe(true);
    expect(frameTarget).toEqual({
      scope: 'content',
      targetType: 'mindmap.frame',
      targetVersion: 1,
      targetPayload: { frameId: 'foundations' },
    });
    expect(() => createMindMapNodeTarget('  ')).toThrow(
      'Mind Map nodeId 无效',
    );
    expect(() => createMindMapFrameTarget('  ')).toThrow(
      'Mind Map frameId 无效',
    );
  });

  it('declares the renderer facilities and validates persisted view state', () => {
    expect(isAssetWorkbenchManifest(mindMapWorkbenchManifest)).toBe(true);
    expect(mindMapWorkbenchManifest.requiredContentCapabilities).toEqual([
      'read-bytes',
    ]);

    const viewState = cloneMindMapWorkbenchViewState({
      collapsedNodeIds: ['root'],
      viewport: { x: 12, y: -4, zoom: 0.8 },
    });

    expect(isMindMapWorkbenchViewState(viewState)).toBe(true);
    expect(createMindMapSaveViewStateCommand(viewState)).toEqual({
      type: 'mindmap:save-view-state',
      payload: { viewState },
    });
    expect(
      isMindMapWorkbenchViewState({
        collapsedNodeIds: ['root', 'root'],
      }),
    ).toBe(false);
    expect(
      isMindMapWorkbenchViewState({
        collapsedNodeIds: [],
        viewport: { x: 0, y: 0, zoom: 0 },
      }),
    ).toBe(false);
  });

  it('accepts only complete JSON-safe bootstrap payloads', () => {
    const payload = {
      document,
      revision: 'revision-1',
      associations: {
        byNode: {},
        byFrame: {},
        staleBindings: [],
      },
      viewState: { collapsedNodeIds: [] },
    };

    expect(isMindMapWorkbenchPayload(payload)).toBe(true);
    expect(
      isMindMapWorkbenchPayload({
        ...payload,
        associations: {
          ...payload.associations,
          byNode: { missing: { references: [], links: [] } },
        },
      }),
    ).toBe(false);
  });

  it('accepts resolved Agent locators and rejects empty locator data', () => {
    const reference = {
      id: 'reference-source',
      projectId: 'project',
      assetId: 'mindmap',
      sourceAssetId: 'source',
      createdTime: 1,
    };
    const payload = {
      document: documentV2,
      revision: 'revision-1',
      associations: {
        byNode: {
          root: {
            references: [
              {
                reference,
                sourceRevision: 'source-revision-1',
                agentLocator: { heading: 'Introduction' },
              },
            ],
            links: [],
          },
        },
        byFrame: {},
        staleBindings: [],
      },
      viewState: { collapsedNodeIds: [] },
    };

    expect(isMindMapWorkbenchPayload(payload)).toBe(true);
    expect(
      isMindMapWorkbenchPayload({
        ...payload,
        associations: {
          ...payload.associations,
          byNode: {
            root: {
              references: [
                {
                  reference,
                  sourceRevision: 'source-revision-1',
                  agentLocator: {},
                },
              ],
              links: [],
            },
          },
        },
      }),
    ).toBe(false);
  });

  it('accepts resolved Targets only when their source revision is retained', () => {
    const reference = {
      id: 'reference-source',
      projectId: 'project',
      assetId: 'mindmap',
      sourceAssetId: 'source',
      createdTime: 1,
    };
    const binding = {
      reference,
      sourceRevision: 'source-revision-1',
      target: { scope: 'asset' as const },
    };
    const payload = {
      document: documentV3,
      revision: 'revision-1',
      associations: {
        byNode: {
          root: { references: [binding], links: [] },
        },
        byFrame: {},
        staleBindings: [],
      },
      viewState: { collapsedNodeIds: [] },
    };

    expect(isMindMapWorkbenchPayload(payload)).toBe(true);
    expect(isMindMapWorkbenchPayload({
      ...payload,
      associations: {
        ...payload.associations,
        byNode: {
          root: {
            references: [{ ...binding, sourceRevision: ' ' }],
            links: [],
          },
        },
      },
    })).toBe(false);
  });
});
