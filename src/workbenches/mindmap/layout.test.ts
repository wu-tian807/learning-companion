import { describe, expect, it } from 'vitest';

import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  type MindMapDocumentV1,
} from './document';
import { createMindMapLayout } from './layout';

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
      childIds: ['basis', 'simplex'],
    },
    basis: {
      id: 'basis',
      title: '基与基本解',
      focus: '基础定义',
      childIds: ['feasible'],
    },
    feasible: {
      id: 'feasible',
      title: '基本可行解',
      focus: '可行性条件',
      childIds: [],
    },
    simplex: {
      id: 'simplex',
      title: '单纯形法',
      focus: '算法过程',
      childIds: [],
    },
  },
  frames: {},
  associations: { nodes: {}, frames: {} },
};

describe('createMindMapLayout', () => {
  it('lays out the complete strict tree from left to right', () => {
    const layout = createMindMapLayout(document, new Set());
    const positions = new Map(
      layout.nodes.map((node) => [node.id, node.position]),
    );

    expect(layout.nodes.map(({ id }) => id)).toEqual([
      'root',
      'basis',
      'feasible',
      'simplex',
    ]);
    expect(layout.edges.map(({ id }) => id)).toEqual([
      'root->basis',
      'root->simplex',
      'basis->feasible',
    ]);
    expect(positions.get('basis')!.x).toBeGreaterThan(
      positions.get('root')!.x,
    );
    expect(positions.get('feasible')!.x).toBeGreaterThan(
      positions.get('basis')!.x,
    );
    expect(
      layout.nodes.every(
        ({ position }) =>
          Number.isFinite(position.x) && Number.isFinite(position.y),
      ),
    ).toBe(true);
  });

  it('removes descendants of collapsed nodes without changing content', () => {
    const layout = createMindMapLayout(document, new Set(['basis']));

    expect(layout.nodes.map(({ id }) => id)).toEqual([
      'root',
      'basis',
      'simplex',
    ]);
    expect(layout.edges.map(({ id }) => id)).toEqual([
      'root->basis',
      'root->simplex',
    ]);
    expect(
      layout.nodes.find(({ id }) => id === 'basis')
        ?.hiddenDescendantCount,
    ).toBe(1);
    expect(document.nodes.basis.childIds).toEqual(['feasible']);
  });

  it('can collapse the entire tree to its root', () => {
    const layout = createMindMapLayout(document, new Set(['root']));

    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]).toMatchObject({
      id: 'root',
      hiddenDescendantCount: 3,
    });
    expect(layout.edges).toEqual([]);
  });
});
