import { describe, expect, it } from 'vitest';

import {
  cloneMindMapDocument,
  cloneMindMapDocumentV1,
  cloneMindMapDocumentV2,
  cloneMindMapDocumentV3,
  isMindMapDocument,
  isMindMapDocumentV1,
  isMindMapDocumentV2,
  isMindMapDocumentV3,
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  MIND_MAP_DOCUMENT_VERSION_V2,
  MIND_MAP_DOCUMENT_VERSION_V3,
  type MindMapDocumentV2,
  type MindMapDocumentV3,
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
                targetType: 'pdf.page-region',
                targetVersion: 1,
                targetPayload: { pageNumber: 3 },
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

function createDocumentV2(): MindMapDocumentV2 {
  return {
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION_V2,
    title: ' Agent 定位 ',
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        title: '课程',
        focus: '课程总览',
        childIds: ['chapter'],
      },
      chapter: {
        id: 'chapter',
        title: '第一章',
        focus: '核心概念',
        childIds: [],
      },
    },
    frames: {
      overview: {
        id: 'overview',
        title: '总览',
        nodeIds: ['root', 'chapter'],
      },
    },
    associations: {
      nodes: {
        root: {
          references: [
            {
              referenceId: 'reference-source',
              sourceRevision: 'source-revision-1',
              agentLocator: {
                headingPath: ['课程', '引言'],
                quote: '先建立课程的整体认识',
                customHint: {
                  page: 3,
                  nearby: true,
                },
              },
            },
            {
              referenceId: 'reference-source',
              sourceRevision: 'source-revision-1',
              agentLocator: {
                headingPath: ['课程', '学习路线'],
                description: '说明章节之间依赖关系的段落',
              },
            },
          ],
          linkIds: [],
        },
      },
      frames: {},
    },
  };
}

function createDocumentV3(): MindMapDocumentV3 {
  return {
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION_V3,
    title: ' Target 定位 ',
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        title: '课程',
        focus: '课程总览',
        childIds: [],
      },
    },
    frames: {},
    associations: {
      nodes: {
        root: {
          references: [{
            referenceId: 'reference-source',
            sourceRevision: 'revision-1',
            target: {
              scope: 'content',
              targetType: 'markdown.source-range',
              targetVersion: 1,
              targetPayload: {
                ranges: [{ start: 0, end: 2, exact: '课程' }],
              },
            },
          }],
          linkIds: [],
        },
      },
      frames: {},
    },
  };
}

describe('Mind Map document contract', () => {
  it('accepts and deeply clones the v3 AssetTarget association contract', () => {
    const document = cloneMindMapDocumentV3(createDocumentV3());

    expect(document.title).toBe('Target 定位');
    expect(document.associations.nodes.root.references[0]).toEqual({
      referenceId: 'reference-source',
      sourceRevision: 'revision-1',
      target: createDocumentV3().associations.nodes.root.references[0].target,
    });
    expect(Object.isFrozen(
      document.associations.nodes.root.references[0].target,
    )).toBe(true);
    expect(isMindMapDocumentV3(document)).toBe(true);
    expect(cloneMindMapDocument(document)).toEqual(document);
  });

  it('rejects a v3 Target binding without a usable source revision', () => {
    const document = createDocumentV3();
    const binding = document.associations.nodes.root.references[0];

    expect(
      isMindMapDocumentV3({
        ...document,
        associations: {
          ...document.associations,
          nodes: {
            root: {
              references: [{ ...binding, sourceRevision: '  ' }],
              linkIds: [],
            },
          },
        },
      }),
    ).toBe(false);
  });

  it('normalizes the pre-Target anchor wire shape while reading a legacy v1 document', () => {
    const document = createDocument();
    const legacy = {
      ...document,
      associations: {
        ...document.associations,
        nodes: {
          'basic-solution': {
            references: [{
              referenceId: 'reference-pdf',
              sourceTarget: {
                scope: 'content',
                anchorType: 'pdf.page-region',
                anchorVersion: 1,
                anchorPayload: { pageNumber: 3 },
              },
            }],
            linkIds: [],
          },
        },
      },
    };

    expect(isMindMapDocumentV1(legacy)).toBe(true);
    expect(
      cloneMindMapDocumentV1(legacy as unknown as ReturnType<typeof createDocument>)
        .associations.nodes['basic-solution'].references[0].sourceTarget,
    ).toEqual({
      scope: 'content',
      targetType: 'pdf.page-region',
      targetVersion: 1,
      targetPayload: { pageNumber: 3 },
    });
  });

  it('accepts flexible Agent locators and preserves repeated locations in one source', () => {
    const document = cloneMindMapDocumentV2(createDocumentV2());

    expect(document.title).toBe('Agent 定位');
    expect(document.associations.nodes.root.references).toHaveLength(2);
    expect(
      document.associations.nodes.root.references.map(
        ({ referenceId }) => referenceId,
      ),
    ).toEqual(['reference-source', 'reference-source']);
    expect(
      document.associations.nodes.root.references[0].agentLocator,
    ).toEqual({
      headingPath: ['课程', '引言'],
      quote: '先建立课程的整体认识',
      customHint: { page: 3, nearby: true },
    });
    expect(
      Object.isFrozen(
        document.associations.nodes.root.references[0].agentLocator
          .customHint,
      ),
    ).toBe(true);
    expect(isMindMapDocument(document)).toBe(true);
    expect(cloneMindMapDocument(document)).toEqual(document);
  });

  it.each([
    {},
    [],
    'page 3',
    null,
    { page: Number.POSITIVE_INFINITY },
  ])(
    'rejects an unusable Agent locator: %j',
    (agentLocator) => {
      const document = createDocumentV2();

      expect(
        isMindMapDocumentV2({
          ...document,
          associations: {
            ...document.associations,
            nodes: {
              root: {
                references: [
                  {
                    referenceId: 'reference-source',
                    sourceRevision: 'source-revision-1',
                    agentLocator,
                  },
                ],
                linkIds: [],
              },
            },
          },
        }),
      ).toBe(false);
    },
  );

  it('rejects a missing source revision and keeps legacy v1 readable', () => {
    const document = createDocumentV2();
    const binding = document.associations.nodes.root.references[0];

    expect(
      isMindMapDocumentV2({
        ...document,
        associations: {
          ...document.associations,
          nodes: {
            root: {
              references: [{ ...binding, sourceRevision: '  ' }],
              linkIds: [],
            },
          },
        },
      }),
    ).toBe(false);
    expect(isMindMapDocument(createDocument())).toBe(true);
  });

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
        targetType: 'pdf.page-region',
        targetVersion: 1,
        targetPayload: { pageNumber: 3 },
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
