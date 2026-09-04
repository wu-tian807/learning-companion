import { describe, expect, it, vi } from 'vitest';

import type { AssetAssociationServiceApi } from '../../../main/asset-associations/asset-association-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import type {
  GenerationTaskProcessContext,
  TaskAgentSession,
} from '../../../main/generation/contracts/task-definition';
import { AssetTargetRegistry } from '../../../main/workbench/asset-target-registry';
import { MIND_MAP_DOCUMENT_VERSION } from '../document';
import { markdownMainFeature } from '../../markdown/main-feature';
import { MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE } from '../../markdown/shared';
import { videoTargetMainFeature } from '../../video/target-main-feature';
import { decodeMindMapDocument } from '../mindmap-content-adapter';
import { MindMapGenerationInstruction } from './mindmap-generation-instruction';
import {
  MIND_MAP_GENERATION_CANDIDATE_FORMAT,
  MIND_MAP_GENERATION_CANDIDATE_VERSION,
  validateMindMapGenerationCandidate,
} from './mindmap-generation-output';
import {
  MIND_MAP_GENERATION_SYSTEM_INSTRUCTION,
  MindMapGenerationProcessor,
} from './mindmap-generation-processor';

function createTargetRegistry(): AssetTargetRegistry {
  const targets = new AssetTargetRegistry();
  markdownMainFeature.registerAssetTargets?.({ targets });
  videoTargetMainFeature.registerAssetTargets?.({ targets });
  return targets;
}

const targetValidationContext = {
  assetReferences: {
    sources: [
      {
        alias: 'sources-0001',
        assetId: 'asset-1',
        name: 'lesson.md',
        mediaType: 'text/markdown',
        workbenchId: 'builtin.markdown',
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
        sourceReferences: [
          {
            sourceAlias: 'sources-0001',
            target: {
              scope: 'content',
              targetType: MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
              targetVersion: 1,
              targetPayload: {
                ranges: [{ start: 0, end: 2, exact: '课程' }],
              },
            },
          },
          {
            sourceAlias: 'sources-0001',
            target: { scope: 'asset' },
          },
        ],
      },
      'chapter-1': {
        id: 'chapter-1',
        title: '第一章',
        focus: '核心概念',
        childIds: [],
        sourceReferences: [
          { sourceAlias: 'sources-0001', target: { scope: 'asset' } },
        ],
      },
    },
    frames: {
      overview: {
        id: 'overview',
        title: '讲义范围',
        nodeIds: ['root', 'chapter-1'],
        sourceReferences: [
          { sourceAlias: 'sources-0001', target: { scope: 'asset' } },
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
    assetReferences: targetValidationContext.assetReferences,
    preparedUserMessage: createTextAgentUserMessage('生成思维导图'),
    agent,
    reportStatus: vi.fn(),
    reportOutputRejected: vi.fn(),
    ...overrides,
  };
}

function createWritableAssets(onWrite?: (content: Uint8Array) => void) {
  const close = vi.fn(async () => undefined);
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
          onWrite?.(content);
          return { revision: 'final-revision' };
        }),
        close,
      },
    })),
    refresh: vi.fn(async () => ({ id: 'generated-asset' })),
    delete: vi.fn(async () => undefined),
  } as unknown as AssetServiceApi;

  return { assets, close };
}

function createAssociations(): AssetAssociationServiceApi {
  return {
    getActiveProjectId: vi.fn(() => 'project-1'),
    ensureReference: vi.fn(
      (
        _assetId: string,
        { sourceAssetId }: { readonly sourceAssetId: string },
      ) => ({ id: `reference-${sourceAssetId}` }),
    ),
  } as unknown as AssetAssociationServiceApi;
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

  it('accepts repeated canonical Targets registered by the source Workbench', () => {
    const result = validateMindMapGenerationCandidate(createCandidate(), {
      ...targetValidationContext,
      targets: createTargetRegistry(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.version).toBe(3);
      expect(result.value.nodes.root.sourceReferences).toHaveLength(2);
      expect(Object.isFrozen(
        result.value.nodes.root.sourceReferences[0].target,
      )).toBe(true);
    }
  });

  it('rejects retired candidate versions, legacy fields and foreign Targets', () => {
    const targets = createTargetRegistry();
    const candidate = createCandidate();

    for (const version of [1, 2]) {
      expect(validateMindMapGenerationCandidate(
        { ...candidate, version },
        { ...targetValidationContext, targets },
      ).ok).toBe(false);
    }

    const legacyReference = structuredClone(candidate) as unknown as Record<
      string,
      unknown
    >;
    const legacyRoot = (
      legacyReference.nodes as Record<string, Record<string, unknown>>
    ).root;
    legacyRoot.sourceReferences = [{
      sourceAlias: 'sources-0001',
      agentLocator: { heading: '课程' },
    }];

    const foreignTarget = structuredClone(candidate) as unknown as Record<
      string,
      unknown
    >;
    const foreignRoot = (
      foreignTarget.nodes as Record<string, Record<string, unknown>>
    ).root;
    foreignRoot.sourceReferences = [{
      sourceAlias: 'sources-0001',
      target: {
        scope: 'content',
        targetType: 'video.time-range',
        targetVersion: 1,
        targetPayload: { startSeconds: 0, endSeconds: 1 },
      },
    }];

    expect(validateMindMapGenerationCandidate(
      legacyReference as never,
      { ...targetValidationContext, targets },
    ).ok).toBe(false);
    const invalidTarget = validateMindMapGenerationCandidate(
      foreignTarget as never,
      { ...targetValidationContext, targets },
    );
    expect(invalidTarget.ok).toBe(false);
    if (!invalidTarget.ok) {
      expect(invalidTarget.issues).toContainEqual(expect.objectContaining({
        path: 'output.nodes.root.sourceReferences.0.target',
      }));
    }
  });

  it('rejects non-tree output and unknown source aliases', () => {
    const candidate = createCandidate();
    const result = validateMindMapGenerationCandidate({
      ...candidate,
      nodes: {
        ...candidate.nodes,
        'chapter-1': {
          ...candidate.nodes['chapter-1'],
          childIds: ['root'],
          sourceReferences: [{
            sourceAlias: 'not-provided',
            target: { scope: 'asset' },
          }],
        },
      },
    }, {
      ...targetValidationContext,
      targets: createTargetRegistry(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map(({ message }) => message).join('\n'))
        .toMatch(/严格树|未知来源/u);
    }
  });

  it('normalizes candidate content without leaking undeclared node fields', () => {
    const candidate = createCandidate();
    const result = validateMindMapGenerationCandidate({
      ...candidate,
      nodes: {
        ...candidate.nodes,
        root: {
          ...candidate.nodes.root,
          title: ' 课程 ',
          internalNote: 'must not escape validation',
        },
      },
    }, {
      ...targetValidationContext,
      targets: createTargetRegistry(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes.root.title).toBe('课程');
      expect(result.value.nodes.root).not.toHaveProperty('internalNote');
    }
  });

  it('creates the current document, adds the Target catalog and persists Targets', async () => {
    let writtenContent: Uint8Array | undefined;
    const { assets, close } = createWritableAssets((content) => {
      writtenContent = content;
    });
    const associations = createAssociations();
    const targets = createTargetRegistry();
    const processor = new MindMapGenerationProcessor(
      assets,
      associations,
      targets,
      { readFile: vi.fn(async () => JSON.stringify(createCandidate())) },
    );
    const processContext = createProcessContext({
      assetReferences: {
        sources: [
          {
            ...targetValidationContext.assetReferences.sources[0],
            name: 'slides.pptx',
            mediaType:
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            materializedMediaType: 'application/pdf',
            relativePath: 'references/sources-0001/slides.pdf',
          },
          {
            alias: 'sources-0002',
            assetId: 'asset-2',
            name: 'lesson.mp4',
            mediaType: 'video/mp4',
            workbenchId: 'builtin.video',
            contentRevision: 'revision-2',
            relativePath: 'references/sources-0002/lesson.mp4',
            artifacts: [{
              producerId: 'builtin.media-subtitles.srt',
              artifactKey: 'source.srt',
              mediaType: 'application/x-subrip',
              contentRevision: 'subtitle-revision',
              relativePath: 'references/sources-0002/artifacts/0001.srt',
            }],
          },
        ],
      },
    });

    await expect(processor.process(processContext)).resolves.toEqual({
      resultAssetId: 'generated-asset',
    });
    const generationCall = vi.mocked(processContext.agent.call).mock.calls[0]![0];
    expect(generationCall).toMatchObject({
      systemInstruction: MIND_MAP_GENERATION_SYSTEM_INSTRUCTION,
      toolRequirements: [
        { id: 'workspace_read_pdf', availability: 'required' },
        { id: 'workspace_read_video', availability: 'required' },
      ],
    });
    const targetCatalogText = generationCall.userMessage.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    expect(targetCatalogText).toContain(MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE);
    expect(targetCatalogText).toContain('video.time-range');
    expect(associations.ensureReference).toHaveBeenCalledWith(
      'generated-asset',
      { sourceAssetId: 'asset-1' },
    );

    const document = decodeMindMapDocument(writtenContent!);
    expect(document.version).toBe(MIND_MAP_DOCUMENT_VERSION);
    expect(document.associations.nodes.root.references).toEqual([
      {
        referenceId: 'reference-asset-1',
        contentRevision: 'revision-1',
        target: createCandidate().nodes.root.sourceReferences[0].target,
      },
      {
        referenceId: 'reference-asset-1',
        contentRevision: 'revision-1',
        target: { scope: 'asset' },
      },
    ]);
    expect(document.associations.frames.overview.references[0].target)
      .toEqual({ scope: 'asset' });
    expect(close).toHaveBeenCalledOnce();
    expect(assets.refresh).toHaveBeenCalledWith('generated-asset');
  });

  it('uses bounded repair turns before rejecting invalid output', async () => {
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
    const targets = createTargetRegistry();
    const processor = new MindMapGenerationProcessor(
      assets,
      associations,
      targets,
      { readFile: vi.fn(async () => JSON.stringify(invalid)) },
    );
    const processContext = createProcessContext();

    await expect(processor.process(processContext)).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
      issues: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/严格树/u) }),
      ]),
    });
    expect(processContext.agent.call).toHaveBeenCalledTimes(4);
    expect(processContext.agent.call).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        callKey: 'repair-1',
        purpose: 'repair',
        systemInstruction: MIND_MAP_GENERATION_SYSTEM_INSTRUCTION,
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
    const associations = createAssociations();
    const processor = new MindMapGenerationProcessor(
      assets,
      associations,
      createTargetRegistry(),
      { readFile: vi.fn(async () => JSON.stringify(createCandidate())) },
    );

    await expect(processor.process(createProcessContext())).rejects
      .toThrow('Generated Mind Map 内容不可写');
    expect(assets.delete).toHaveBeenCalledWith('generated-asset');
  });
});
