import { describe, expect, it } from 'vitest';

import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION_V3,
  type MindMapDocumentV3,
} from './document';
import {
  createMindMapFrameTarget,
  createMindMapNodeTarget,
} from './shared';
import { resolveMindMapTargetNavigation } from './target-navigation';

const document: MindMapDocumentV3 = {
  format: MIND_MAP_DOCUMENT_FORMAT,
  version: MIND_MAP_DOCUMENT_VERSION_V3,
  title: '课程',
  rootNodeId: 'root',
  nodes: {
    root: { id: 'root', title: '课程', focus: '总览', childIds: ['chapter'] },
    chapter: { id: 'chapter', title: '章节', focus: '章节', childIds: ['detail'] },
    detail: { id: 'detail', title: '细节', focus: '细节', childIds: [] },
  },
  frames: {
    lesson: { id: 'lesson', title: '课时', nodeIds: ['chapter', 'detail'] },
  },
  associations: { nodes: {}, frames: {} },
};

describe('Mind Map Target navigation', () => {
  it('resolves a node and every collapsed ancestor without leaking tree logic to the host', () => {
    const navigation = resolveMindMapTargetNavigation(
      document,
      createMindMapNodeTarget('detail'),
    );

    expect(navigation?.nodeIds).toEqual(['detail']);
    expect(navigation?.selectedNodeId).toBe('detail');
    expect(navigation!.visibleNodeIds).toEqual([
      'detail',
      'chapter',
      'root',
    ]);
  });

  it('resolves a Frame to its nodes and rejects missing Targets', () => {
    expect(resolveMindMapTargetNavigation(
      document,
      createMindMapFrameTarget('lesson'),
    )?.nodeIds).toEqual(['chapter', 'detail']);
    expect(resolveMindMapTargetNavigation(
      document,
      createMindMapNodeTarget('missing'),
    )).toBeUndefined();
    expect(resolveMindMapTargetNavigation(
      document,
      { scope: 'asset' },
    )).toBeUndefined();
  });
});
