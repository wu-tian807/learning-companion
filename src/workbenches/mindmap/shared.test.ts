import { describe, expect, it } from 'vitest';

import { isAssetWorkbenchManifest } from '../../shared/workbench/manifest';
import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  type MindMapDocumentV1,
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

describe('Mind Map interaction targets', () => {
  it('creates stable Node and Frame Anchors', () => {
    const nodeTarget = createMindMapNodeTarget('basic-solution');
    const frameTarget = createMindMapFrameTarget('foundations');

    expect(isMindMapNodeTarget(nodeTarget)).toBe(true);
    expect(nodeTarget).toEqual({
      scope: 'content',
      anchorType: 'mindmap.node',
      anchorVersion: 1,
      anchorPayload: { nodeId: 'basic-solution' },
    });
    expect(isMindMapFrameTarget(frameTarget)).toBe(true);
    expect(frameTarget).toEqual({
      scope: 'content',
      anchorType: 'mindmap.frame',
      anchorVersion: 1,
      anchorPayload: { frameId: 'foundations' },
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
});
