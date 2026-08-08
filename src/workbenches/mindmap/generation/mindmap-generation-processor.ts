import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AssetAssociationServiceApi } from '../../../main/asset-associations/asset-association-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import type { PreparedGenerationAssetReferenceBindings } from '../../../main/generation/contracts/generation-asset-reference';
import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
} from '../../../main/generation/contracts/task-definition';
import {
  GenerationOutputValidationError,
  type GenerationValidationIssue,
} from '../../../main/generation/contracts/generation-validation';
import { MIND_MAP_ASSET_MEDIA_TYPE } from '../../../shared/asset-media-types';
import {
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  type MindMapAssociationsV1,
  type MindMapDocumentV1,
  type MindMapSubjectAssociationsV1,
} from '../document';
import { encodeMindMapDocument } from '../mindmap-content-adapter';
import type { MindMapGenerationInstruction } from './mindmap-generation-instruction';
import type {
  MindMapGenerationCandidateFrameV1,
  MindMapGenerationCandidateNodeV1,
  MindMapGenerationCandidateV1,
} from './mindmap-generation-output';
import {
  MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH,
  validateMindMapGenerationCandidateV1,
} from './mindmap-generation-output';

export type MindMapGenerationTaskResult = JsonValue & {
  readonly resultAssetId: string;
};

const wholeAssetTarget = Object.freeze({ scope: 'asset' as const });
const repairsPerProcessRun = 3;

function createEmptyDocument(
  candidate: MindMapGenerationCandidateV1,
): MindMapDocumentV1 {
  return {
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION,
    title: candidate.title,
    rootNodeId: candidate.rootNodeId,
    nodes: Object.fromEntries(
      Object.entries(candidate.nodes).map(([nodeId, node]) => [
        nodeId,
        {
          id: node.id,
          title: node.title,
          focus: node.focus,
          childIds: [...node.childIds],
        },
      ]),
    ),
    frames: Object.fromEntries(
      Object.entries(candidate.frames).map(([frameId, frame]) => [
        frameId,
        {
          id: frame.id,
          title: frame.title,
          nodeIds: [...frame.nodeIds],
        },
      ]),
    ),
    associations: { nodes: {}, frames: {} },
  };
}

function flattenPreparedReferences(
  bindings: PreparedGenerationAssetReferenceBindings,
) {
  return Object.values(bindings).flatMap((references) => references);
}

function createSubjectAssociations(
  subjects: Readonly<
    Record<
      string,
      MindMapGenerationCandidateNodeV1 | MindMapGenerationCandidateFrameV1
    >
  >,
  referenceIdByAlias: ReadonlyMap<string, string>,
): Readonly<Record<string, MindMapSubjectAssociationsV1>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(subjects).flatMap(([subjectId, subject]) => {
        if (subject.sourceAliases.length === 0) {
          return [];
        }

        return [
          [
            subjectId,
            Object.freeze({
              references: Object.freeze(
                subject.sourceAliases.map((alias) => {
                  const referenceId = referenceIdByAlias.get(alias);

                  if (!referenceId) {
                    throw new Error(
                      `Mind Map generation source alias ${alias} 未映射`,
                    );
                  }

                  return Object.freeze({
                    referenceId,
                    sourceTarget: wholeAssetTarget,
                  });
                }),
              ),
              linkIds: Object.freeze([]),
            }),
          ],
        ];
      }),
    ),
  );
}

function withAssociations(
  document: MindMapDocumentV1,
  candidate: MindMapGenerationCandidateV1,
  referenceIdByAlias: ReadonlyMap<string, string>,
): MindMapDocumentV1 {
  const associations: MindMapAssociationsV1 = {
    nodes: createSubjectAssociations(
      candidate.nodes,
      referenceIdByAlias,
    ),
    frames: createSubjectAssociations(
      candidate.frames,
      referenceIdByAlias,
    ),
  };

  return { ...document, associations };
}

function createRepairMessage(
  issues: readonly GenerationValidationIssue[],
): ReturnType<typeof createTextAgentUserMessage> {
  const issueList = issues
    .map(({ path, message }, index) => `${index + 1}. ${path}: ${message}`)
    .join('\n');

  return createTextAgentUserMessage(`应用校验发现你写入的 ${MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH} 不符合协议：

${issueList}

请直接读取并修复现有候选文件。保留其中正确、充分且有学习价值的内容，只修改违反协议的部分；不要重新输出到聊天消息，也不要自行编写校验脚本。修复完成后简短确认。`);
}

export class MindMapGenerationProcessor
  implements
    GenerationTaskProcessor<
      MindMapGenerationInstruction,
      MindMapGenerationTaskResult
    >
{
  constructor(
    private readonly assets: AssetServiceApi,
    private readonly associations: AssetAssociationServiceApi,
    private readonly dependencies: {
      readonly readFile: (path: string, encoding: 'utf8') => Promise<string>;
    } = {
      readFile: (path, encoding) => readFile(path, encoding),
    },
  ) {}

  async process(
    context: GenerationTaskProcessContext<MindMapGenerationInstruction>,
  ): Promise<MindMapGenerationTaskResult> {
    context.signal?.throwIfAborted();
    await context.agent.call({
      callKey: 'generate',
      purpose: 'generation',
      userMessage: context.defaultUserMessage,
    });

    const completedRepairCount = context.agent.completedCalls.filter(
      ({ purpose }) => purpose === 'repair',
    ).length;
    let repairsThisRun = 0;
    let candidate: MindMapGenerationCandidateV1;

    while (true) {
      try {
        candidate = await this.readCandidate(context);
        break;
      } catch (error) {
        if (
          !(error instanceof GenerationOutputValidationError) ||
          repairsThisRun >= repairsPerProcessRun
        ) {
          throw error;
        }

        const repairTurnNumber =
          completedRepairCount + repairsThisRun + 1;
        context.reportOutputRejected(repairTurnNumber, error.issues);
        await context.agent.call({
          callKey: `repair-${repairTurnNumber}`,
          purpose: 'repair',
          userMessage: createRepairMessage(error.issues),
        });
        repairsThisRun += 1;
      }
    }

    context.reportStatus('正在创建思维导图 Asset…');
    return this.commitCandidate(context, candidate);
  }

  private async commitCandidate(
    context: GenerationTaskProcessContext<MindMapGenerationInstruction>,
    candidate: MindMapGenerationCandidateV1,
  ): Promise<MindMapGenerationTaskResult> {
    context.signal?.throwIfAborted();

    if (
      this.assets.getActiveProjectId() !== context.projectId ||
      this.associations.getActiveProjectId() !== context.projectId
    ) {
      throw new Error('Mind Map generation Project 上下文已改变');
    }

    const initialDocument = createEmptyDocument(candidate);
    const staged = await this.assets.stageGeneratedFile(
      context.projectId,
      {
        fileName: `${context.taskId}.mindmap`,
        name: candidate.title,
        mediaType: MIND_MAP_ASSET_MEDIA_TYPE,
        content: encodeMindMapDocument(initialDocument),
      },
    );

    try {
      context.signal?.throwIfAborted();
      const referenceIdByAssetId = new Map<string, string>();
      const referenceIdByAlias = new Map<string, string>();

      for (const prepared of flattenPreparedReferences(
        context.assetReferences,
      )) {
        let referenceId = referenceIdByAssetId.get(prepared.assetId);

        if (!referenceId) {
          referenceId = this.associations.ensureReference(
            staged.asset.id,
            { sourceAssetId: prepared.assetId },
          ).id;
          referenceIdByAssetId.set(prepared.assetId, referenceId);
        }

        referenceIdByAlias.set(prepared.alias, referenceId);
      }

      const finalDocument = withAssociations(
        initialDocument,
        candidate,
        referenceIdByAlias,
      );
      const resolved = await this.assets.resolveContent(staged.asset.id);

      try {
        if (!resolved.handle?.readBytes || !resolved.handle.writeBytes) {
          throw new Error('Generated Mind Map 内容不可写');
        }

        const current = await resolved.handle.readBytes();
        context.signal?.throwIfAborted();
        await resolved.handle.writeBytes({
          content: encodeMindMapDocument(finalDocument),
          expectedRevision: current.revision,
        });
      } finally {
        await resolved.handle?.close();
      }

      context.signal?.throwIfAborted();
      await this.assets.refresh(staged.asset.id);
      return Object.freeze({ resultAssetId: staged.asset.id });
    } catch (error) {
      if (staged.created) {
        await this.assets.delete(staged.asset.id).catch((cleanupError) => {
          console.error('回滚 Mind Map Generated Asset 失败', cleanupError);
        });
      }
      throw error;
    }
  }

  private async readCandidate(
    context: GenerationTaskProcessContext<MindMapGenerationInstruction>,
  ): Promise<MindMapGenerationCandidateV1> {
    const absolutePath = join(
      context.workspaces.primary.path,
      ...MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH.split('/'),
    );
    let value: unknown;

    try {
      value = JSON.parse(
        await this.dependencies.readFile(absolutePath, 'utf8'),
      );
    } catch (error) {
      throw new GenerationOutputValidationError([
        {
          path: MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH,
          message:
            error instanceof Error && error.message.trim().length > 0
              ? `无法读取或解析候选文件：${error.message}`
              : '无法读取或解析候选文件',
        },
      ]);
    }

    if (!isJsonValue(value)) {
      throw new GenerationOutputValidationError([
        {
          path: MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH,
          message: 'Mind Map 候选文件不是有效 JSON 值',
        },
      ]);
    }

    const validated = validateMindMapGenerationCandidateV1(value, {
      assetReferences: context.assetReferences,
    });

    if (!validated.ok) {
      throw new GenerationOutputValidationError(validated.issues);
    }

    return validated.value;
  }
}
