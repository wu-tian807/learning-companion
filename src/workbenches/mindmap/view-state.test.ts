import { describe, expect, it } from 'vitest';

import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  type MindMapDocumentV1,
} from './document';
import {
  collapseMindMapNode,
  expandMindMapNodeOneLevel,
  toggleMindMapNode,
} from './view-state';

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
      childIds: ['chapter'],
    },
    chapter: {
      id: 'chapter',
      title: 'Chapter',
      focus: 'Chapter topic',
      childIds: ['section'],
    },
    section: {
      id: 'section',
      title: 'Section',
      focus: 'Section topic',
      childIds: ['leaf'],
    },
    leaf: {
      id: 'leaf',
      title: 'Leaf',
      focus: 'Leaf topic',
      childIds: [],
    },
  },
  frames: {},
  associations: { nodes: {}, frames: {} },
};

describe('Mind Map view-state transitions', () => {
  it('expands only the clicked node next layer', () => {
    const first = expandMindMapNodeOneLevel(
      document,
      {
        collapsedNodeIds: ['root'],
        viewport: { x: 1, y: 2, zoom: 0.8 },
      },
      'root',
    );

    expect(first).toEqual({
      collapsedNodeIds: ['chapter'],
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });

    const second = expandMindMapNodeOneLevel(
      document,
      first,
      'chapter',
    );

    expect(second.collapsedNodeIds).toEqual(['section']);
  });

  it('re-collapses an expanded branch and preserves deeper state', () => {
    const state = { collapsedNodeIds: ['section'] };
    const collapsed = collapseMindMapNode(
      document,
      state,
      'chapter',
    );

    expect(collapsed.collapsedNodeIds).toEqual([
      'section',
      'chapter',
    ]);
    expect(
      toggleMindMapNode(document, collapsed, 'chapter')
        .collapsedNodeIds,
    ).toEqual(['section']);
  });

  it('does nothing for leaves and already expanded nodes', () => {
    const state = { collapsedNodeIds: [] };

    expect(
      expandMindMapNodeOneLevel(document, state, 'chapter'),
    ).toBe(state);
    expect(collapseMindMapNode(document, state, 'leaf')).toBe(state);
  });
});
