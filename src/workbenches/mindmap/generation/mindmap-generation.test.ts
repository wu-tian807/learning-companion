import { describe, expect, it } from 'vitest';

import { MindMapGenerationInstruction } from './mindmap-generation-instruction';
import { mindMapGenerationOutputContractV1 } from './mindmap-generation-output';

const context = {
  assetReferences: {
    sources: [
      {
        alias: 'sources-0001',
        assetId: 'asset-1',
        name: 'lesson.md',
        mediaType: 'text/markdown',
        contentRevision: 'revision-1',
        relativePath: 'references/sources-0001/source.md',
      },
    ],
  },
};

function createCandidate() {
  return {
    title: '课程结构',
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        title: '课程',
        focus: '课程总览',
        childIds: ['chapter-1'],
        sourceAliases: ['sources-0001'],
      },
      'chapter-1': {
        id: 'chapter-1',
        title: '第一章',
        focus: '核心概念',
        childIds: [],
        sourceAliases: ['sources-0001'],
      },
    },
    frames: {
      overview: {
        id: 'overview',
        title: '讲义范围',
        nodeIds: ['root', 'chapter-1'],
        sourceAliases: ['sources-0001'],
      },
    },
  } as const;
}

describe('Mind Map generation contracts', () => {
  it('turns its custom Instruction into a user message', () => {
    const instruction = new MindMapGenerationInstruction({
      additionalInstructions: '强调章节之间的依赖',
    });

    expect(instruction.toUserMessage().content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('强调章节之间的依赖'),
      },
    ]);
    expect(instruction.toSnapshot()).toMatchObject({
      format: 'learning-companion/mindmap-generation-instruction',
      version: 1,
    });
  });

  it('accepts a strict tree with source aliases and multi-node frames', () => {
    const result = mindMapGenerationOutputContractV1.validate(
      createCandidate(),
      context,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects non-tree output and unknown source aliases', () => {
    const candidate = createCandidate();
    const result = mindMapGenerationOutputContractV1.validate(
      {
        ...candidate,
        nodes: {
          ...candidate.nodes,
          'chapter-1': {
            ...candidate.nodes['chapter-1'],
            childIds: ['root'],
            sourceAliases: ['not-provided'],
          },
        },
      },
      context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map(({ message }) => message).join('\n')).toMatch(
        /严格树|未知来源/,
      );
    }
  });
});
