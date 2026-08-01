import { describe, expect, it } from 'vitest';

import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  type MindMapDocumentV1,
} from './document';
import {
  createMindMapExpandAllGrowthWave,
  createMindMapNodeGrowthWave,
} from './renderer-growth';

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
      childIds: ['chapter-a', 'chapter-b'],
    },
    'chapter-a': {
      id: 'chapter-a',
      title: 'Chapter A',
      focus: 'First chapter',
      childIds: ['section'],
    },
    section: {
      id: 'section',
      title: 'Section',
      focus: 'Nested section',
      childIds: ['leaf'],
    },
    leaf: {
      id: 'leaf',
      title: 'Leaf',
      focus: 'Leaf topic',
      childIds: [],
    },
    'chapter-b': {
      id: 'chapter-b',
      title: 'Chapter B',
      focus: 'Second chapter',
      childIds: [],
    },
  },
  frames: {},
  associations: { nodes: {}, frames: {} },
};

describe('Mind Map growth waves', () => {
  it('stagers direct children from the expanded branch', () => {
    const wave = createMindMapNodeGrowthWave(document, 'root');

    expect(wave?.edgeDelayById).toEqual(
      new Map([
        ['root->chapter-a', 0],
        ['root->chapter-b', 42],
      ]),
    );
    expect(wave?.nodeDelayById).toEqual(
      new Map([
        ['chapter-a', 90],
        ['chapter-b', 132],
      ]),
    );
  });

  it('grows an entire hidden tree one depth after another', () => {
    const wave = createMindMapExpandAllGrowthWave(
      document,
      new Set(['root']),
    );

    expect(wave?.edgeDelayById.get('root->chapter-a')).toBe(0);
    expect(wave?.edgeDelayById.get('chapter-a->section')).toBe(150);
    expect(wave?.edgeDelayById.get('section->leaf')).toBe(300);
    expect(wave?.nodeDelayById.get('leaf')).toBe(390);
  });

  it('starts from the nearest visible branch when expanding all', () => {
    const wave = createMindMapExpandAllGrowthWave(
      document,
      new Set(['chapter-a']),
    );

    expect(wave?.edgeDelayById.get('chapter-a->section')).toBe(0);
    expect(wave?.edgeDelayById.get('section->leaf')).toBe(150);
    expect(wave?.nodeDelayById.has('chapter-a')).toBe(false);
  });
});
