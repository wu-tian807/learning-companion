import { describe, expect, it } from 'vitest';

import {
  cloneMindMapDocumentV1,
  createMindMapNodeTarget,
  isMindMapDocumentV1,
  isMindMapNodeTarget,
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
} from './shared';

function createDocument() {
  return {
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION,
    title: ' 线性规划 ',
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        title: '线性规划',
        focus: '线性规划的核心问题与学习路径',
        childIds: ['basic-solution', 'simplex'],
      },
      'basic-solution': {
        id: 'basic-solution',
        title: '基本解',
        focus: '基本解、基本可行解的定义及差异',
        childIds: [],
      },
      simplex: {
        id: 'simplex',
        title: '单纯形法',
        focus: '单纯形法如何在相邻基本可行解之间移动',
        childIds: [],
      },
    },
    nodeAssociations: {
      root: { references: [], linkIds: [] },
      'basic-solution': {
        references: [
          {
            referenceId: 'reference-pdf',
            sourceTarget: {
              scope: 'content',
              anchorType: 'pdf.page-region',
              anchorVersion: 1,
              anchorPayload: { pageNumber: 3 },
            },
          },
        ],
        linkIds: ['link-basic-solution-lecture'],
      },
      simplex: { references: [], linkIds: [] },
    },
  } as const;
}

describe('Mind Map document contract', () => {
  it('accepts and clones one complete normalized node tree', () => {
    const document = cloneMindMapDocumentV1(createDocument());

    expect(document.title).toBe('线性规划');
    expect(document.nodes.root.childIds).toEqual([
      'basic-solution',
      'simplex',
    ]);
    expect(document.nodeAssociations['basic-solution'].linkIds).toEqual([
      'link-basic-solution-lecture',
    ]);
    expect(
      document.nodeAssociations['basic-solution'].references[0],
    ).toEqual({
      referenceId: 'reference-pdf',
      sourceTarget: {
        scope: 'content',
        anchorType: 'pdf.page-region',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 3 },
      },
    });
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.nodes.root.childIds)).toBe(true);
    expect(
      Object.isFrozen(
        document.nodeAssociations['basic-solution'].references[0]
          .sourceTarget,
      ),
    ).toBe(true);
  });

  it('requires one complete association record for every node', () => {
    const document = createDocument();

    expect(
      isMindMapDocumentV1({
        ...document,
        nodeAssociations: {
          root: { references: [], linkIds: [] },
          'basic-solution': { references: [], linkIds: [] },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        nodeAssociations: {
          root: { references: [], linkIds: [] },
          'basic-solution': { references: [], linkIds: [] },
          unknown: { references: [], linkIds: [] },
        },
      }),
    ).toBe(false);
  });

  it('rejects duplicate Link IDs and invalid source targets', () => {
    const document = createDocument();

    expect(
      isMindMapDocumentV1({
        ...document,
        nodeAssociations: {
          ...document.nodeAssociations,
          simplex: {
            references: [],
            linkIds: ['link', 'link'],
          },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        nodeAssociations: {
          ...document.nodeAssociations,
          simplex: {
            references: [
              {
                referenceId: 'reference',
                sourceTarget: { scope: 'content' },
              },
            ],
            linkIds: [],
          },
        },
      }),
    ).toBe(false);
  });

  it('rejects missing, shared and disconnected nodes', () => {
    const document = createDocument();

    expect(
      isMindMapDocumentV1({
        ...document,
        nodes: {
          ...document.nodes,
          root: { ...document.nodes.root, childIds: ['missing'] },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        nodes: {
          ...document.nodes,
          'basic-solution': {
            ...document.nodes['basic-solution'],
            childIds: ['simplex'],
          },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        nodes: {
          ...document.nodes,
          root: { ...document.nodes.root, childIds: ['basic-solution'] },
        },
      }),
    ).toBe(false);
  });

  it('creates a stable node Anchor for generic workbench interactions', () => {
    const target = createMindMapNodeTarget('basic-solution');

    expect(isMindMapNodeTarget(target)).toBe(true);
    expect(target).toEqual({
      scope: 'content',
      anchorType: 'mindmap.node',
      anchorVersion: 1,
      anchorPayload: { nodeId: 'basic-solution' },
    });
    expect(() => createMindMapNodeTarget('  ')).toThrow(
      'Mind Map nodeId 无效',
    );
  });
});
