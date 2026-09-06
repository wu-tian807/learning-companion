import { describe, expect, it } from 'vitest';

import {
  cloneMindMapDocument,
  isMindMapDocument,
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  type MindMapDocument,
} from './document';

function createDocument(): MindMapDocument {
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
              contentRevision: 'pdf-revision-1',
              target: {
                scope: 'content',
                targetType: 'pdf.page-region',
                targetVersion: 1,
                targetPayload: { pageNumber: 3 },
              },
            },
          ],
          links: [{
            linkId: 'link-basic-solution-answer',
            contentRevision: 'answer-revision-1',
            target: { scope: 'asset' },
          }],
        },
      },
      frames: {
        foundations: {
          references: [],
          links: [{
            linkId: 'link-foundations-lecture',
            contentRevision: 'lecture-revision-1',
            target: { scope: 'asset' },
          }],
        },
      },
    },
  };
}

describe('Mind Map document contract', () => {
  it('accepts and deeply clones the current versioned AssetTarget contract', () => {
    const document = cloneMindMapDocument(createDocument());

    expect(document.version).toBe(4);
    expect(document.title).toBe('线性规划');
    expect(document.frames.foundations.title).toBe('基础概念讲义');
    expect(document.associations.nodes['basic-solution'].references[0])
      .toEqual({
        referenceId: 'reference-pdf',
        contentRevision: 'pdf-revision-1',
        target: {
          scope: 'content',
          targetType: 'pdf.page-region',
          targetVersion: 1,
          targetPayload: { pageNumber: 3 },
        },
      });
    expect(isMindMapDocument(document)).toBe(true);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.nodes.root.childIds)).toBe(true);
    expect(Object.isFrozen(
      document.associations.nodes['basic-solution'].references[0].target,
    )).toBe(true);
  });

  it('keeps a version marker but rejects retired document versions', () => {
    for (const version of [1, 2, 3]) {
      expect(isMindMapDocument({ ...createDocument(), version })).toBe(false);
    }
  });

  it('rejects legacy locator fields and pre-Target anchor wire fields', () => {
    const document = createDocument();
    const withBinding = (binding: unknown) => ({
      ...document,
      associations: {
        ...document.associations,
        nodes: {
          'basic-solution': {
            references: [binding],
            links: [],
          },
        },
      },
    });

    expect(isMindMapDocument(withBinding({
      referenceId: 'reference-pdf',
      sourceTarget: { scope: 'asset' },
    }))).toBe(false);
    expect(isMindMapDocument(withBinding({
      referenceId: 'reference-pdf',
      contentRevision: 'pdf-revision-1',
      agentLocator: { page: 3 },
    }))).toBe(false);
    expect(isMindMapDocument(withBinding({
      referenceId: 'reference-pdf',
      contentRevision: 'pdf-revision-1',
      target: {
        scope: 'content',
        anchorType: 'pdf.page-region',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 3 },
      },
    }))).toBe(false);
  });

  it('requires source revision and a complete canonical Target', () => {
    const document = createDocument();
    const binding = document.associations.nodes['basic-solution'].references[0];
    const withBinding = (replacement: unknown) => ({
      ...document,
      associations: {
        ...document.associations,
        nodes: {
          'basic-solution': { references: [replacement], links: [] },
        },
      },
    });

    expect(isMindMapDocument(withBinding({
      ...binding,
      contentRevision: '  ',
    }))).toBe(false);
    expect(isMindMapDocument(withBinding({
      ...binding,
      target: { scope: 'content' },
    }))).toBe(false);
    expect(isMindMapDocument(withBinding({
      ...binding,
      agentLocator: { page: 3 },
    }))).toBe(false);
  });

  it('allows repeated source references and sparse associations', () => {
    const document = createDocument();
    const binding = document.associations.nodes['basic-solution'].references[0];

    expect(isMindMapDocument({
      ...document,
      associations: {
        nodes: {
          root: {
            references: [
              { ...binding, target: { scope: 'asset' } },
              binding,
            ],
            links: [],
          },
        },
        frames: {},
      },
    })).toBe(true);
    expect(isMindMapDocument({
      ...document,
      associations: { nodes: {}, frames: {} },
    })).toBe(true);
  });

  it('rejects unknown association subjects and duplicate link IDs', () => {
    const document = createDocument();

    expect(isMindMapDocument({
      ...document,
      associations: {
        ...document.associations,
        nodes: { unknown: { references: [], links: [] } },
      },
    })).toBe(false);
    expect(isMindMapDocument({
      ...document,
      associations: {
        ...document.associations,
        frames: { unknown: { references: [], links: [] } },
      },
    })).toBe(false);
    expect(isMindMapDocument({
      ...document,
      associations: {
        ...document.associations,
        nodes: { root: { references: [], links: ['link', 'link'] } },
      },
    })).toBe(false);
  });

  it('rejects invalid Frame membership without changing tree semantics', () => {
    const document = createDocument();

    for (const frame of [
      { ...document.frames.foundations, nodeIds: ['basic-solution', 'missing'] },
      { ...document.frames.foundations, nodeIds: ['simplex', 'simplex'] },
      { ...document.frames.foundations, nodeIds: [] },
      { ...document.frames.foundations, id: 'other-frame' },
    ]) {
      expect(isMindMapDocument({
        ...document,
        frames: { foundations: frame },
      })).toBe(false);
    }
  });

  it('rejects missing, shared and disconnected tree nodes', () => {
    const document = createDocument();

    expect(isMindMapDocument({
      ...document,
      nodes: {
        ...document.nodes,
        root: { ...document.nodes.root, childIds: ['missing'] },
      },
    })).toBe(false);
    expect(isMindMapDocument({
      ...document,
      nodes: {
        ...document.nodes,
        'basic-solution': {
          ...document.nodes['basic-solution'],
          childIds: ['simplex'],
        },
      },
    })).toBe(false);
    expect(isMindMapDocument({
      ...document,
      nodes: {
        ...document.nodes,
        root: { ...document.nodes.root, childIds: ['basic-solution'] },
      },
    })).toBe(false);
  });
});
