import { describe, expect, it } from 'vitest';

import { createMindMapGenerationDraft } from './mind-map-generation-draft';

describe('createMindMapGenerationDraft', () => {
  it('deduplicates source IDs while preserving their order', () => {
    expect(
      createMindMapGenerationDraft({
        projectId: ' project ',
        sourceAssetIds: ['asset-b', 'asset-a', 'asset-b'],
        additionalInstructions: '  重点梳理概念关系  ',
      }),
    ).toEqual({
      projectId: 'project',
      sourceAssetIds: ['asset-b', 'asset-a'],
      additionalInstructions: '重点梳理概念关系',
    });
  });

  it('omits blank additional instructions', () => {
    expect(
      createMindMapGenerationDraft({
        projectId: 'project',
        sourceAssetIds: ['asset'],
        additionalInstructions: '   ',
      }),
    ).toEqual({
      projectId: 'project',
      sourceAssetIds: ['asset'],
    });
  });

  it('rejects an empty project or source list', () => {
    expect(() =>
      createMindMapGenerationDraft({
        projectId: ' ',
        sourceAssetIds: ['asset'],
      }),
    ).toThrow('Mind Map 生成缺少 Project ID');
    expect(() =>
      createMindMapGenerationDraft({
        projectId: 'project',
        sourceAssetIds: [],
      }),
    ).toThrow('Mind Map 生成至少需要一份来源资料');
  });
});
