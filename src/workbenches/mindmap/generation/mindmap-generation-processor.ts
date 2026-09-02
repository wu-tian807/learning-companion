import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AssetAssociationServiceApi } from '../../../main/asset-associations/asset-association-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import {
  createTextAgentUserMessage,
} from '../../../main/generation/contracts/agent-message';
import type { AssetTargetRegistryApi } from '../../../main/workbench/asset-target-registry';
import type { PreparedGenerationAssetReferenceBindings } from '../../../main/generation/contracts/generation-asset-reference';
import {
  appendAssetTargetCatalogToUserMessage,
  flattenPreparedGenerationAssetReferences,
} from '../../../main/generation/preparation/generation-asset-target-catalog';
import type {
  AgentToolRequirement,
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
import type {
  MindMapDocument,
  MindMapDocumentV1,
  MindMapDocumentV2,
  MindMapDocumentV3,
} from '../document';
import { encodeMindMapDocument } from '../mindmap-content-adapter';
import { PDF_READ_FUNCTION_TOOL_ID } from '../../pdf/agent/pdf-function-tool';
import { VIDEO_READ_FUNCTION_TOOL_ID } from '../../video/agent/video-function-tool';
import type { MindMapGenerationInstruction } from './mindmap-generation-instruction';
import type { MindMapGenerationCandidateV1 } from './mindmap-generation-output';
import { MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH } from './mindmap-generation-output';
import type { MindMapGenerationCandidateV2 } from './mindmap-generation-output-v2';
import type { MindMapGenerationCandidateV3 } from './mindmap-generation-output-v3';
import {
  mindMapGenerationProtocolV1,
  mindMapGenerationProtocolV2,
  mindMapGenerationProtocolV3,
  type MindMapGenerationProtocol,
  type PreparedMindMapReferenceBinding,
} from './mindmap-generation-protocol';

export {
  MIND_MAP_GENERATION_SYSTEM_INSTRUCTION_V1,
  MIND_MAP_GENERATION_SYSTEM_INSTRUCTION_V2,
  MIND_MAP_GENERATION_SYSTEM_INSTRUCTION_V3,
} from './mindmap-generation-protocol';

export type MindMapGenerationTaskResult = JsonValue & {
  readonly resultAssetId: string;
};

interface MindMapGenerationCandidateBase {
  readonly title: string;
}

interface MindMapGenerationProcessorDependencies {
  readonly readFile: (path: string, encoding: 'utf8') => Promise<string>;
}

const repairsPerProcessRun = 3;
const emptyAssetTargetRegistry: AssetTargetRegistryApi = Object.freeze({
  register: () => undefined,
  get: () => undefined,
  listForWorkbench: () => Object.freeze([]),
  validate: () => false,
  describe: () => undefined,
  assertManifest: () => undefined,
});

function flattenPreparedReferences(
  bindings: PreparedGenerationAssetReferenceBindings,
) {
  return flattenPreparedGenerationAssetReferences(bindings);
}

function mindMapToolRequirements(
  references: PreparedGenerationAssetReferenceBindings,
): readonly AgentToolRequirement[] {
  const mediaTypes = new Set(
    flattenPreparedReferences(references).flatMap((reference) => [
      reference.materializedMediaType ?? reference.mediaType,
      ...(reference.artifacts ?? []).map(({ mediaType }) => mediaType),
    ]),
  );
  const requirements: AgentToolRequirement[] = [];

  if (mediaTypes.has('application/pdf')) {
    requirements.push({
      id: PDF_READ_FUNCTION_TOOL_ID,
      availability: 'required',
    });
  }

  if ([...mediaTypes].some((mediaType) => mediaType.startsWith('video/'))) {
    requirements.push({
      id: VIDEO_READ_FUNCTION_TOOL_ID,
      availability: 'required',
    });
  }

  return Object.freeze(
    requirements.map((requirement) => Object.freeze(requirement)),
  );
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

class ProtocolMindMapGenerationProcessor<
    TCandidate extends MindMapGenerationCandidateBase,
    TDocument extends MindMapDocument,
  >
  implements
    GenerationTaskProcessor<
      MindMapGenerationInstruction,
      MindMapGenerationTaskResult
    >
{
  constructor(
    private readonly assets: AssetServiceApi,
    private readonly associations: AssetAssociationServiceApi,
    private readonly protocol: MindMapGenerationProtocol<
      TCandidate,
      TDocument
    >,
    private readonly targets?: AssetTargetRegistryApi,
    private readonly dependencies: MindMapGenerationProcessorDependencies = {
      readFile: (path, encoding) => readFile(path, encoding),
    },
  ) {}

  async process(
    context: GenerationTaskProcessContext<MindMapGenerationInstruction>,
  ): Promise<MindMapGenerationTaskResult> {
    context.signal?.throwIfAborted();
    const toolRequirements = mindMapToolRequirements(
      context.assetReferences,
    );
    const userMessage = this.protocol.usesAssetTargets
      ? appendAssetTargetCatalogToUserMessage(
          context.preparedUserMessage,
          context.assetReferences,
          this.requireTargets(),
        )
      : context.preparedUserMessage;
    await context.agent.call({
      callKey: 'generate',
      purpose: 'generation',
      systemInstruction: this.protocol.systemInstruction,
      userMessage,
      toolRequirements,
      skills: [],
      mcpServers: [],
    });

    const completedRepairCount = context.agent.completedCalls.filter(
      ({ purpose }) => purpose === 'repair',
    ).length;
    let repairsThisRun = 0;
    let candidate: TCandidate;

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
          systemInstruction: this.protocol.systemInstruction,
          userMessage: createRepairMessage(error.issues),
          toolRequirements,
          skills: [],
          mcpServers: [],
        });
        repairsThisRun += 1;
      }
    }

    context.reportStatus('正在创建思维导图 Asset…');
    return this.commitCandidate(context, candidate);
  }

  private async commitCandidate(
    context: GenerationTaskProcessContext<MindMapGenerationInstruction>,
    candidate: TCandidate,
  ): Promise<MindMapGenerationTaskResult> {
    context.signal?.throwIfAborted();

    if (
      this.assets.getActiveProjectId() !== context.projectId ||
      this.associations.getActiveProjectId() !== context.projectId
    ) {
      throw new Error('Mind Map generation Project 上下文已改变');
    }

    const initialDocument = this.protocol.createEmptyDocument(candidate);
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
      const referencesByAlias = new Map<
        string,
        PreparedMindMapReferenceBinding
      >();

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

        referencesByAlias.set(
          prepared.alias,
          Object.freeze({
            referenceId,
            sourceRevision: prepared.contentRevision,
          }),
        );
      }

      const finalDocument = this.protocol.withAssociations(
        initialDocument,
        candidate,
        referencesByAlias,
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
  ): Promise<TCandidate> {
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

    const validated = this.protocol.validateCandidate(value, {
      assetReferences: context.assetReferences,
      targets: this.requireTargets(),
    });

    if (!validated.ok) {
      throw new GenerationOutputValidationError(validated.issues);
    }

    return validated.value;
  }

  private requireTargets(): AssetTargetRegistryApi {
    if (this.targets) {
      return this.targets;
    }
    if (this.protocol.usesAssetTargets) {
      throw new Error('Mind Map generation 缺少 AssetTarget Registry');
    }
    return emptyAssetTargetRegistry;
  }
}

export class LegacyMindMapGenerationProcessor extends ProtocolMindMapGenerationProcessor<
  MindMapGenerationCandidateV1,
  MindMapDocumentV1
> {
  constructor(
    assets: AssetServiceApi,
    associations: AssetAssociationServiceApi,
    dependencies?: MindMapGenerationProcessorDependencies,
  ) {
    super(
      assets,
      associations,
      mindMapGenerationProtocolV1,
      undefined,
      dependencies,
    );
  }
}

export class MindMapGenerationProcessor extends ProtocolMindMapGenerationProcessor<
  MindMapGenerationCandidateV2,
  MindMapDocumentV2
> {
  constructor(
    assets: AssetServiceApi,
    associations: AssetAssociationServiceApi,
    dependencies?: MindMapGenerationProcessorDependencies,
  ) {
    super(
      assets,
      associations,
      mindMapGenerationProtocolV2,
      undefined,
      dependencies,
    );
  }
}

export class AssetTargetMindMapGenerationProcessor extends ProtocolMindMapGenerationProcessor<
  MindMapGenerationCandidateV3,
  MindMapDocumentV3
> {
  constructor(
    assets: AssetServiceApi,
    associations: AssetAssociationServiceApi,
    targets: AssetTargetRegistryApi,
    dependencies?: MindMapGenerationProcessorDependencies,
  ) {
    super(
      assets,
      associations,
      mindMapGenerationProtocolV3,
      targets,
      dependencies,
    );
  }
}
