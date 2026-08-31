import { describe, expect, it, vi } from 'vitest';

import type { AssetAssociationServiceApi } from '../../../main/asset-associations/asset-association-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import type {
  GenerationTaskProcessContext,
  TaskAgentSession,
} from '../../../main/generation/contracts/task-definition';
import {
  MIND_MAP_DOCUMENT_VERSION,
  MIND_MAP_DOCUMENT_VERSION_V2,
} from '../document';
import { decodeMindMapDocument } from '../mindmap-content-adapter';
import { MindMapGenerationInstruction } from './mindmap-generation-instruction';
import {
  MIND_MAP_GENERATION_CANDIDATE_FORMAT,
  MIND_MAP_GENERATION_CANDIDATE_VERSION,
  validateMindMapGenerationCandidateV1,
} from './mindmap-generation-output';
import {
  MIND_MAP_GENERATION_CANDIDATE_VERSION_V2,
  validateMindMapGenerationCandidateV2,
} from './mindmap-generation-output-v2';
import {
  LegacyMindMapGenerationProcessor,
  MIND_MAP_GENERATION_SYSTEM_INSTRUCTION_V1,
  MIND_MAP_GENERATION_SYSTEM_INSTRUCTION_V2,
  MindMapGenerationProcessor,
} from './mindmap-generation-processor';

const validationContext = {
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

function createLegacyCandidate() {
  return {
    format: MIND_MAP_GENERATION_CANDIDATE_FORMAT,
    version: MIND_MAP_GENERATION_CANDIDATE_VERSION,
    title: '旧版课程结构',
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

function createCandidate() {
  return {
    format: MIND_MAP_GENERATION_CANDIDATE_FORMAT,
    version: MIND_MAP_GENERATION_CANDIDATE_VERSION_V2,
    title: '课程结构',
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        title: '课程',
        focus: '课程总览',
        childIds: ['chapter-1'],
        sourceReferences: [
          {
            sourceAlias: 'sources-0001',
            agentLocator: {
              headingPath: ['课程', '导言'],
              quote: '课程总览',
            },
          },
          {
            sourceAlias: 'sources-0001',
            agentLocator: {
              custom: {
                sectionNumber: '0.2',
                semanticHint: '章节之间的关系',
              },
            },
          },
        ],
      },
      'chapter-1': {
        id: 'chapter-1',
        title: '第一章',
        focus: '核心概念',
        childIds: [],
        sourceReferences: [
          {
            sourceAlias: 'sources-0001',
            agentLocator: {
              page: 4,
              description: '核心概念的定义与示例',
            },
          },
        ],
      },
    },
    frames: {
      overview: {
        id: 'overview',
        title: '讲义范围',
        nodeIds: ['root', 'chapter-1'],
        sourceReferences: [
          {
            sourceAlias: 'sources-0001',
            agentLocator: {
              wholeAsset: true,
              reason: '该 Frame 是整份课程的总览',
            },
          },
        ],
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
        connectionId: 'codex-account',
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
        permissions: { read: true, write: true },
        instanceKey: 'task-1',
        path: '/tmp/task-1',
      },
      secondary: [],
    },
    assetReferences: validationContext.assetReferences,
    preparedUserMessage: createTextAgentUserMessage('生成思维导图'),
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

  it('keeps the v1 candidate contract readable for task recovery', () => {
    const result = validateMindMapGenerationCandidateV1(
      createLegacyCandidate(),
      validationContext,
    );

    expect(result.ok).toBe(true);
  });

  it('accepts free-form locators and repeated locations for one source', () => {
    const result = validateMindMapGenerationCandidateV2(
      createCandidate(),
      validationContext,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes.root.sourceReferences).toHaveLength(2);
      expect(
        result.value.nodes.root.sourceReferences[1].agentLocator,
      ).toEqual({
        custom: {
          sectionNumber: '0.2',
          semanticHint: '章节之间的关系',
        },
      });
      expect(
        Object.isFrozen(
          result.value.nodes.root.sourceReferences[1].agentLocator
            .custom,
        ),
      ).toBe(true);
    }
  });

  it('rejects non-tree output, unknown aliases and empty locators', () => {
    const candidate = createCandidate();
    const invalidTreeAndAlias = validateMindMapGenerationCandidateV2(
      {
        ...candidate,
        nodes: {
          ...candidate.nodes,
          'chapter-1': {
            ...candidate.nodes['chapter-1'],
            childIds: ['root'],
            sourceReferences: [
              {
                sourceAlias: 'not-provided',
                agentLocator: { page: 1 },
              },
            ],
          },
        },
      },
      validationContext,
    );
    const emptyLocator = validateMindMapGenerationCandidateV2(
      {
        ...candidate,
        nodes: {
          ...candidate.nodes,
          root: {
            ...candidate.nodes.root,
            sourceReferences: [
              {
                sourceAlias: 'sources-0001',
                agentLocator: {},
              },
            ],
          },
        },
      },
      validationContext,
    );

    expect(invalidTreeAndAlias.ok).toBe(false);
    if (!invalidTreeAndAlias.ok) {
      expect(
        invalidTreeAndAlias.issues
          .map(({ message }) => message)
          .join('\n'),
      ).toMatch(/严格树|未知来源/u);
    }
    expect(emptyLocator.ok).toBe(false);
    if (!emptyLocator.ok) {
      expect(emptyLocator.issues[0].message).toMatch(/来源定位/u);
    }
  });

  it('creates a v2 Asset and maps aliases to revisioned Agent locators', async () => {
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
      ensureReference: vi.fn(
        (
          _assetId: string,
          { sourceAssetId }: { readonly sourceAssetId: string },
        ) => ({
          id: `reference-${sourceAssetId}`,
        }),
      ),
    } as unknown as AssetAssociationServiceApi;
    const processor = new MindMapGenerationProcessor(
      assets,
      associations,
      {
        readFile: vi.fn(async () => JSON.stringify(createCandidate())),
      },
    );
    const processContext = createProcessContext({
      assetReferences: {
        sources: [
          {
            alias: 'sources-0001',
            assetId: 'asset-1',
            name: 'slides.pptx',
            mediaType:
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            materializedMediaType: 'application/pdf',
            contentRevision: 'revision-1',
            relativePath: 'references/sources-0001/slides.pdf',
          },
          {
            alias: 'sources-0002',
            assetId: 'asset-2',
            name: 'diagram.png',
            mediaType: 'image/png',
            contentRevision: 'revision-2',
            relativePath: 'references/sources-0002/diagram.png',
          },
        ],
      },
    });

    await expect(processor.process(processContext)).resolves.toEqual({
      resultAssetId: 'generated-asset',
    });
    expect(processContext.agent.call).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInstruction: MIND_MAP_GENERATION_SYSTEM_INSTRUCTION_V2,
        toolRequirements: [
          { id: 'workspace_read_pdf', availability: 'required' },
        ],
      }),
    );
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
    expect(document.version).toBe(MIND_MAP_DOCUMENT_VERSION_V2);
    expect(document.associations.nodes.root).toEqual({
      references: [
        {
          referenceId: 'reference-asset-1',
          sourceRevision: 'revision-1',
          agentLocator: {
            headingPath: ['课程', '导言'],
            quote: '课程总览',
          },
        },
        {
          referenceId: 'reference-asset-1',
          sourceRevision: 'revision-1',
          agentLocator: {
            custom: {
              sectionNumber: '0.2',
              semanticHint: '章节之间的关系',
            },
          },
        },
      ],
      linkIds: [],
    });
    expect(document.associations.frames.overview?.references).toEqual([
      {
        referenceId: 'reference-asset-1',
        sourceRevision: 'revision-1',
        agentLocator: {
          wholeAsset: true,
          reason: '该 Frame 是整份课程的总览',
        },
      },
    ]);
    expect(close).toHaveBeenCalledOnce();
    expect(assets.refresh).toHaveBeenCalledWith('generated-asset');
  });

  it('keeps the legacy processor on the v1 prompt and document contract', async () => {
    let writtenContent: Uint8Array | undefined;
    const assets = {
      getActiveProjectId: vi.fn(() => 'project-1'),
      stageGeneratedFile: vi.fn(async () => ({
        asset: { id: 'generated-asset' },
        created: true,
      })),
      resolveContent: vi.fn(async () => ({
        handle: {
          readBytes: vi.fn(async () => ({
            content: new Uint8Array(),
            revision: 'initial-revision',
          })),
          writeBytes: vi.fn(async ({ content }) => {
            writtenContent = content;
            return { revision: 'final-revision' };
          }),
          close: vi.fn(async () => undefined),
        },
      })),
      refresh: vi.fn(async () => ({ id: 'generated-asset' })),
      delete: vi.fn(async () => undefined),
    } as unknown as AssetServiceApi;
    const associations = {
      getActiveProjectId: vi.fn(() => 'project-1'),
      ensureReference: vi.fn(() => ({ id: 'reference-1' })),
    } as unknown as AssetAssociationServiceApi;
    const processor = new LegacyMindMapGenerationProcessor(
      assets,
      associations,
      {
        readFile: vi.fn(async () =>
          JSON.stringify(createLegacyCandidate()),
        ),
      },
    );
    const processContext = createProcessContext();

    await processor.process(processContext);

    expect(processContext.agent.call).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        systemInstruction: MIND_MAP_GENERATION_SYSTEM_INSTRUCTION_V1,
      }),
    );
    expect(writtenContent).toBeDefined();
    const document = decodeMindMapDocument(writtenContent!);
    expect(document.version).toBe(MIND_MAP_DOCUMENT_VERSION);
    expect(document.associations.nodes.root.references).toEqual([
      {
        referenceId: 'reference-1',
        sourceTarget: { scope: 'asset' },
      },
    ]);
  });

  it('uses bounded v2 repair turns before rejecting invalid output', async () => {
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
    expect(processContext.agent.call).toHaveBeenNthCalledWith(1, {
      callKey: 'generate',
      purpose: 'generation',
      systemInstruction: MIND_MAP_GENERATION_SYSTEM_INSTRUCTION_V2,
      userMessage: processContext.preparedUserMessage,
      toolRequirements: [],
      skills: [],
      mcpServers: [],
    });
    expect(processContext.agent.call).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        callKey: 'repair-1',
        purpose: 'repair',
        systemInstruction: MIND_MAP_GENERATION_SYSTEM_INSTRUCTION_V2,
      }),
    );
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
