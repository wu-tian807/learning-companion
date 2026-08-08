import { describe, expect, it, vi } from 'vitest';

import type { AssetAssociationServiceApi } from '../../../main/asset-associations/asset-association-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import type {
  GenerationTaskProcessContext,
  TaskAgentSession,
} from '../../../main/generation/contracts/task-definition';
import { decodeMindMapDocument } from '../mindmap-content-adapter';
import { MindMapGenerationInstruction } from './mindmap-generation-instruction';
import {
  MIND_MAP_GENERATION_CANDIDATE_FORMAT,
  MIND_MAP_GENERATION_CANDIDATE_VERSION,
  validateMindMapGenerationCandidateV1,
} from './mindmap-generation-output';
import { MindMapGenerationProcessor } from './mindmap-generation-processor';

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
    format: MIND_MAP_GENERATION_CANDIDATE_FORMAT,
    version: MIND_MAP_GENERATION_CANDIDATE_VERSION,
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

function createProcessContext(
  overrides: Partial<
    GenerationTaskProcessContext<MindMapGenerationInstruction>
  > = {},
): GenerationTaskProcessContext<MindMapGenerationInstruction> {
  const agent: TaskAgentSession = {
    completedCalls: [],
    call: vi.fn(async ({ callKey, purpose }) => ({
      callKey,
      purpose,
      sessionId: 'session-1',
      metrics: {
        callKey,
        purpose,
        sessionId: 'session-1',
        providerId: 'codex',
        modelId: 'gpt-test',
        startedTime: 1,
        completedTime: 2,
        activeDurationMs: 1,
        turnCount: 1,
        repairTurnCount: purpose === 'repair' ? 1 : 0,
      },
    })),
  };

  return {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: new MindMapGenerationInstruction(),
    workspaces: {
      primary: {
        key: 'mindmap',
        scope: 'task',
        permissions: { read: true, write: true },
        instanceKey: 'task-1',
        path: '/tmp/task-1',
      },
      secondary: [],
    },
    assetReferences: context.assetReferences,
    defaultUserMessage: createTextAgentUserMessage('生成思维导图'),
    agent,
    reportStatus: vi.fn(),
    reportOutputRejected: vi.fn(),
    ...overrides,
  };
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
    const result = validateMindMapGenerationCandidateV1(
      createCandidate(),
      context,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects non-tree output and unknown source aliases', () => {
    const candidate = createCandidate();
    const result = validateMindMapGenerationCandidateV1(
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

  it('creates a generated Asset and maps source aliases to AssetReferences', async () => {
    let writtenContent: Uint8Array | undefined;
    const close = vi.fn(async () => undefined);
    const assets = {
      getActiveProjectId: vi.fn(() => 'project-1'),
      stageGeneratedFile: vi.fn(async () => ({
        asset: { id: 'generated-asset' },
        created: true,
      })),
      resolveContent: vi.fn(async () => ({
        handle: {
          capabilities: new Set(['read-bytes', 'write-bytes']),
          readBytes: vi.fn(async () => ({
            content: new Uint8Array(),
            revision: 'initial-revision',
          })),
          writeBytes: vi.fn(async ({ content }) => {
            writtenContent = content;
            return { revision: 'final-revision' };
          }),
          close,
        },
      })),
      refresh: vi.fn(async () => ({ id: 'generated-asset' })),
      delete: vi.fn(async () => undefined),
    } as unknown as AssetServiceApi;
    const associations = {
      getActiveProjectId: vi.fn(() => 'project-1'),
      ensureReference: vi.fn(() => ({ id: 'reference-1' })),
    } as unknown as AssetAssociationServiceApi;
    const processor = new MindMapGenerationProcessor(
      assets,
      associations,
      {
        readFile: vi.fn(async () => JSON.stringify(createCandidate())),
      },
    );

    await expect(
      processor.process(createProcessContext()),
    ).resolves.toEqual({ resultAssetId: 'generated-asset' });

    expect(assets.stageGeneratedFile).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        fileName: 'task-1.mindmap',
        name: '课程结构',
      }),
    );
    expect(associations.ensureReference).toHaveBeenCalledWith(
      'generated-asset',
      { sourceAssetId: 'asset-1' },
    );
    expect(writtenContent).toBeDefined();

    const document = decodeMindMapDocument(writtenContent!);
    expect(document.associations.nodes.root).toEqual({
      references: [
        {
          referenceId: 'reference-1',
          sourceTarget: { scope: 'asset' },
        },
      ],
      linkIds: [],
    });
    expect(document.associations.frames.overview?.references).toEqual([
      {
        referenceId: 'reference-1',
        sourceTarget: { scope: 'asset' },
      },
    ]);
    expect(close).toHaveBeenCalledOnce();
    expect(assets.refresh).toHaveBeenCalledWith('generated-asset');
  });

  it('uses bounded repair turns before rejecting an invalid workspace artifact', async () => {
    const assets = {
      getActiveProjectId: vi.fn(() => 'project-1'),
      stageGeneratedFile: vi.fn(),
    } as unknown as AssetServiceApi;
    const associations = {
      getActiveProjectId: vi.fn(() => 'project-1'),
    } as unknown as AssetAssociationServiceApi;
    const invalid = {
      ...createCandidate(),
      nodes: {
        ...createCandidate().nodes,
        'chapter-1': {
          ...createCandidate().nodes['chapter-1'],
          childIds: ['root'],
        },
      },
    };
    const processor = new MindMapGenerationProcessor(
      assets,
      associations,
      { readFile: vi.fn(async () => JSON.stringify(invalid)) },
    );
    const processContext = createProcessContext();

    await expect(
      processor.process(processContext),
    ).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
      issues: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/严格树/u) }),
      ]),
    });
    expect(processContext.agent.call).toHaveBeenCalledTimes(4);
    expect(processContext.reportOutputRejected).toHaveBeenCalledTimes(3);
    expect(assets.stageGeneratedFile).not.toHaveBeenCalled();
  });

  it('rolls back a newly staged Asset when final content cannot be written', async () => {
    const assets = {
      getActiveProjectId: vi.fn(() => 'project-1'),
      stageGeneratedFile: vi.fn(async () => ({
        asset: { id: 'generated-asset' },
        created: true,
      })),
      resolveContent: vi.fn(async () => ({
        handle: { capabilities: new Set(), close: vi.fn() },
      })),
      delete: vi.fn(async () => undefined),
    } as unknown as AssetServiceApi;
    const associations = {
      getActiveProjectId: vi.fn(() => 'project-1'),
      ensureReference: vi.fn(() => ({ id: 'reference-1' })),
    } as unknown as AssetAssociationServiceApi;
    const processor = new MindMapGenerationProcessor(
      assets,
      associations,
      {
        readFile: vi.fn(async () => JSON.stringify(createCandidate())),
      },
    );

    await expect(
      processor.process(createProcessContext()),
    ).rejects.toThrow('Generated Mind Map 内容不可写');
    expect(assets.delete).toHaveBeenCalledWith('generated-asset');
  });
});
