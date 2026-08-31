import type { PreparedGenerationAssetReferenceBindings } from '../../../main/generation/contracts/generation-asset-reference';
import {
  generationValidationFailure,
  generationValidationSuccess,
  type GenerationValidationIssue,
} from '../../../main/generation/contracts/generation-validation';
import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  cloneMindMapAgentLocatorV1,
  isMindMapAgentLocatorV1,
  isMindMapDocumentV2,
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION_V2,
  type MindMapAgentLocatorV1,
} from '../document';
import {
  MIND_MAP_GENERATION_CANDIDATE_FORMAT,
} from './mindmap-generation-output';

export {
  MIND_MAP_GENERATION_CANDIDATE_FORMAT,
  MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH,
} from './mindmap-generation-output';

export const MIND_MAP_GENERATION_CANDIDATE_VERSION_V2 = 2;

export interface MindMapGenerationCandidateSourceReferenceV2 {
  readonly sourceAlias: string;
  readonly agentLocator: MindMapAgentLocatorV1;
}

export interface MindMapGenerationCandidateNodeV2 {
  readonly id: string;
  readonly title: string;
  readonly focus: string;
  readonly childIds: readonly string[];
  readonly sourceReferences: readonly MindMapGenerationCandidateSourceReferenceV2[];
}

export interface MindMapGenerationCandidateFrameV2 {
  readonly id: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
  readonly sourceReferences: readonly MindMapGenerationCandidateSourceReferenceV2[];
}

export interface MindMapGenerationCandidateV2 {
  readonly format: typeof MIND_MAP_GENERATION_CANDIDATE_FORMAT;
  readonly version: typeof MIND_MAP_GENERATION_CANDIDATE_VERSION_V2;
  readonly title: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, MindMapGenerationCandidateNodeV2>>;
  readonly frames: Readonly<Record<string, MindMapGenerationCandidateFrameV2>>;
}

export interface MindMapGenerationCandidateV2ValidationContext {
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedRequiredText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizedUniqueTextList(
  value: unknown,
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.map(normalizedRequiredText);

  if (
    normalized.some((entry) => entry === undefined) ||
    new Set(normalized).size !== normalized.length
  ) {
    return undefined;
  }

  return normalized as readonly string[];
}

function cloneSourceReference(
  value: unknown,
): MindMapGenerationCandidateSourceReferenceV2 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sourceAlias = normalizedRequiredText(value.sourceAlias);

  if (!sourceAlias || !isMindMapAgentLocatorV1(value.agentLocator)) {
    return undefined;
  }

  return Object.freeze({
    sourceAlias,
    agentLocator: cloneMindMapAgentLocatorV1(value.agentLocator),
  });
}

function cloneSourceReferences(
  value: unknown,
): readonly MindMapGenerationCandidateSourceReferenceV2[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const references = value.map(cloneSourceReference);

  if (references.some((reference) => reference === undefined)) {
    return undefined;
  }

  return Object.freeze(
    references as MindMapGenerationCandidateSourceReferenceV2[],
  );
}

function cloneCandidateNode(
  value: unknown,
): MindMapGenerationCandidateNodeV2 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = normalizedRequiredText(value.id);
  const title = normalizedRequiredText(value.title);
  const focus = normalizedRequiredText(value.focus);
  const childIds = normalizedUniqueTextList(value.childIds);
  const sourceReferences = cloneSourceReferences(value.sourceReferences);

  if (!id || !title || !focus || !childIds || !sourceReferences) {
    return undefined;
  }

  return Object.freeze({
    id,
    title,
    focus,
    childIds: Object.freeze(childIds),
    sourceReferences,
  });
}

function cloneCandidateFrame(
  value: unknown,
): MindMapGenerationCandidateFrameV2 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = normalizedRequiredText(value.id);
  const title = normalizedRequiredText(value.title);
  const nodeIds = normalizedUniqueTextList(value.nodeIds);
  const sourceReferences = cloneSourceReferences(value.sourceReferences);

  if (
    !id ||
    !title ||
    !nodeIds ||
    nodeIds.length === 0 ||
    !sourceReferences
  ) {
    return undefined;
  }

  return Object.freeze({
    id,
    title,
    nodeIds: Object.freeze(nodeIds),
    sourceReferences,
  });
}

function availableSourceAliases(
  context: MindMapGenerationCandidateV2ValidationContext,
): ReadonlySet<string> {
  return new Set(
    Object.values(context.assetReferences).flatMap((references) =>
      references.map(({ alias }) => alias),
    ),
  );
}

export function validateMindMapGenerationCandidateV2(
  value: JsonValue,
  context: MindMapGenerationCandidateV2ValidationContext,
) {
  const issues: GenerationValidationIssue[] = [];

  if (
    !isRecord(value) ||
    value.format !== MIND_MAP_GENERATION_CANDIDATE_FORMAT ||
    value.version !== MIND_MAP_GENERATION_CANDIDATE_VERSION_V2 ||
    !normalizedRequiredText(value.title) ||
    !normalizedRequiredText(value.rootNodeId) ||
    !isRecord(value.nodes) ||
    !isRecord(value.frames)
  ) {
    return generationValidationFailure<MindMapGenerationCandidateV2>([
      { path: 'output', message: 'Mind Map candidate v2 顶层结构无效' },
    ]);
  }

  const title = normalizedRequiredText(value.title)!;
  const rootNodeId = normalizedRequiredText(value.rootNodeId)!;

  const nodes = Object.fromEntries(
    Object.entries(value.nodes).flatMap(([nodeId, node]) => {
      const cloned = cloneCandidateNode(node);

      if (!cloned || cloned.id !== nodeId) {
        issues.push({
          path: `output.nodes.${nodeId}`,
          message:
            'Mind Map node 数据无效、缺少来源定位或 ID 与键不一致',
        });
        return [];
      }

      return [[nodeId, cloned]];
    }),
  );
  const frames = Object.fromEntries(
    Object.entries(value.frames).flatMap(([frameId, frame]) => {
      const cloned = cloneCandidateFrame(frame);

      if (!cloned || cloned.id !== frameId) {
        issues.push({
          path: `output.frames.${frameId}`,
          message:
            'Mind Map frame 数据无效、缺少来源定位或 ID 与键不一致',
        });
        return [];
      }

      return [[frameId, cloned]];
    }),
  );

  if (issues.length > 0) {
    return generationValidationFailure<MindMapGenerationCandidateV2>(issues);
  }

  if (
    !isMindMapDocumentV2({
      format: MIND_MAP_DOCUMENT_FORMAT,
      version: MIND_MAP_DOCUMENT_VERSION_V2,
      title,
      rootNodeId,
      nodes: Object.fromEntries(
        Object.entries(nodes).map(([nodeId, node]) => [
          nodeId,
          {
            id: node.id,
            title: node.title,
            focus: node.focus,
            childIds: node.childIds,
          },
        ]),
      ),
      frames: Object.fromEntries(
        Object.entries(frames).map(([frameId, frame]) => [
          frameId,
          {
            id: frame.id,
            title: frame.title,
            nodeIds: frame.nodeIds,
          },
        ]),
      ),
      associations: { nodes: {}, frames: {} },
    })
  ) {
    issues.push({
      path: 'output',
      message: 'Mind Map candidate 必须形成严格树且 Frame 引用有效节点',
    });
  }

  const aliases = availableSourceAliases(context);

  for (const [subjectKind, subjects] of [
    ['nodes', nodes],
    ['frames', frames],
  ] as const) {
    for (const [subjectId, subject] of Object.entries(subjects)) {
      for (const reference of subject.sourceReferences) {
        if (!aliases.has(reference.sourceAlias)) {
          issues.push({
            path: `output.${subjectKind}.${subjectId}.sourceReferences`,
            message: `引用了未知来源 alias：${reference.sourceAlias}`,
          });
        }
      }
    }
  }

  if (issues.length > 0) {
    return generationValidationFailure<MindMapGenerationCandidateV2>(issues);
  }

  return generationValidationSuccess(
    Object.freeze({
      format: MIND_MAP_GENERATION_CANDIDATE_FORMAT,
      version: MIND_MAP_GENERATION_CANDIDATE_VERSION_V2,
      title,
      rootNodeId,
      nodes: Object.freeze(nodes),
      frames: Object.freeze(frames),
    }),
  );
}
