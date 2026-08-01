import { describe, expect, it } from 'vitest';

import {
  cloneMindMapDocumentV1,
  isMindMapDocumentV1,
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
} from './document';

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
    frames: {
      foundations: {
        id: 'foundations',
        title: ' 基础概念讲义 ',
        nodeIds: ['basic-solution', 'simplex'],
      },
    },
    associations: {
      nodes: {
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
          linkIds: ['link-basic-solution-answer'],
        },
      },
      frames: {
        foundations: {
          references: [],
          linkIds: ['link-foundations-lecture'],
        },
      },
    },
  } as const;
}

describe('Mind Map document contract', () => {
  it('accepts and clones a normalized tree with sparse associations and Frames', () => {
    const document = cloneMindMapDocumentV1(createDocument());

    expect(document.title).toBe('线性规划');
    expect(document.nodes.root.childIds).toEqual([
      'basic-solution',
      'simplex',
    ]);
    expect(document.frames.foundations).toEqual({
      id: 'foundations',
      title: '基础概念讲义',
      nodeIds: ['basic-solution', 'simplex'],
    });
    expect(document.associations.nodes.root).toBeUndefined();
    expect(
      document.associations.nodes['basic-solution'].references[0],
    ).toEqual({
      referenceId: 'reference-pdf',
      sourceTarget: {
        scope: 'content',
        anchorType: 'pdf.page-region',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 3 },
      },
    });
    expect(document.associations.frames.foundations.linkIds).toEqual([
      'link-foundations-lecture',
    ]);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.nodes.root.childIds)).toBe(true);
    expect(Object.isFrozen(document.frames.foundations.nodeIds)).toBe(
      true,
    );
    expect(
      Object.isFrozen(
        document.associations.nodes['basic-solution'].references[0]
          .sourceTarget,
      ),
    ).toBe(true);
  });

  it('allows sparse associations but rejects unknown Node and Frame subjects', () => {
    const document = createDocument();

    expect(
      isMindMapDocumentV1({
        ...document,
        associations: { nodes: {}, frames: {} },
      }),
    ).toBe(true);
    expect(
      isMindMapDocumentV1({
        ...document,
        associations: {
          ...document.associations,
          nodes: {
            unknown: { references: [], linkIds: [] },
          },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        associations: {
          ...document.associations,
          frames: {
            unknown: { references: [], linkIds: [] },
          },
        },
      }),
    ).toBe(false);
  });

  it('rejects invalid Frame membership without changing tree semantics', () => {
    const document = createDocument();

    expect(
      isMindMapDocumentV1({
        ...document,
        frames: {
          foundations: {
            ...document.frames.foundations,
            nodeIds: ['basic-solution', 'missing'],
          },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        frames: {
          foundations: {
            ...document.frames.foundations,
            nodeIds: ['simplex', 'simplex'],
          },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        frames: {
          foundations: {
            ...document.frames.foundations,
            nodeIds: [],
          },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        frames: {
          foundations: {
            ...document.frames.foundations,
            id: 'other-frame',
          },
        },
      }),
    ).toBe(false);
  });

  it('rejects duplicate association IDs and invalid source targets', () => {
    const document = createDocument();

    expect(
      isMindMapDocumentV1({
        ...document,
        associations: {
          ...document.associations,
          nodes: {
            root: {
              references: [],
              linkIds: ['link', 'link'],
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        associations: {
          ...document.associations,
          frames: {
            foundations: {
              references: [
                {
                  referenceId: 'reference',
                  sourceTarget: { scope: 'asset' },
                },
                {
                  referenceId: 'reference',
                  sourceTarget: { scope: 'asset' },
                },
              ],
              linkIds: [],
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      isMindMapDocumentV1({
        ...document,
        associations: {
          ...document.associations,
          nodes: {
            root: {
              references: [
                {
                  referenceId: 'reference',
                  sourceTarget: { scope: 'content' },
                },
              ],
              linkIds: [],
            },
          },
        },
      }),
    ).toBe(false);
  });

  it('rejects missing, shared and disconnected tree nodes', () => {
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
});
