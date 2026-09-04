import type { PreparedGenerationAssetReferenceBindings } from '../../../main/generation/contracts/generation-asset-reference';
import {
  generationValidationFailure,
  generationValidationSuccess,
  type GenerationValidationIssue,
} from '../../../main/generation/contracts/generation-validation';
import type { AssetTargetRegistryApi } from '../../../main/workbench/asset-target-registry';
import {
  cloneAssetTarget,
  isAssetTarget,
  type AssetTarget,
} from '../../../shared/workbench/asset-target';
import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  isMindMapDocument,
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
} from '../document';

export const MIND_MAP_GENERATION_CANDIDATE_FORMAT =
  'learning-companion/mindmap-generation-candidate';
export const MIND_MAP_GENERATION_CANDIDATE_VERSION = 3;
export const MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH =
  'output/mindmap-candidate.json';

export interface MindMapGenerationCandidateSourceReference {
  readonly sourceAlias: string;
  readonly target: AssetTarget;
}

export interface MindMapGenerationCandidateNode {
  readonly id: string;
  readonly title: string;
  readonly focus: string;
  readonly childIds: readonly string[];
  readonly sourceReferences: readonly MindMapGenerationCandidateSourceReference[];
}

export interface MindMapGenerationCandidateFrame {
  readonly id: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
  readonly sourceReferences: readonly MindMapGenerationCandidateSourceReference[];
}

export interface MindMapGenerationCandidate {
  readonly format: typeof MIND_MAP_GENERATION_CANDIDATE_FORMAT;
  readonly version: typeof MIND_MAP_GENERATION_CANDIDATE_VERSION;
  readonly title: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, MindMapGenerationCandidateNode>>;
  readonly frames: Readonly<Record<string, MindMapGenerationCandidateFrame>>;
}

export interface MindMapGenerationCandidateValidationContext {
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly targets: AssetTargetRegistryApi;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
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
): MindMapGenerationCandidateSourceReference | undefined {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ['sourceAlias', 'target']) ||
    !isAssetTarget(value.target)
  ) {
    return undefined;
  }

  const sourceAlias = normalizedRequiredText(value.sourceAlias);
  if (!sourceAlias) {
    return undefined;
  }

  return Object.freeze({
    sourceAlias,
    target: cloneAssetTarget(value.target),
  });
}

function cloneSourceReferences(
  value: unknown,
): readonly MindMapGenerationCandidateSourceReference[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const references = value.map(cloneSourceReference);
  if (references.some((reference) => reference === undefined)) {
    return undefined;
  }

  return Object.freeze(
    references as MindMapGenerationCandidateSourceReference[],
  );
}

function cloneCandidateNode(
  value: unknown,
): MindMapGenerationCandidateNode | undefined {
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
): MindMapGenerationCandidateFrame | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = normalizedRequiredText(value.id);
  const title = normalizedRequiredText(value.title);
  const nodeIds = normalizedUniqueTextList(value.nodeIds);
  const sourceReferences = cloneSourceReferences(value.sourceReferences);

  if (!id || !title || !nodeIds || nodeIds.length === 0 || !sourceReferences) {
    return undefined;
  }

  return Object.freeze({
    id,
    title,
    nodeIds: Object.freeze(nodeIds),
    sourceReferences,
  });
}

function referencesByAlias(
  bindings: PreparedGenerationAssetReferenceBindings,
) {
  return new Map(
    Object.values(bindings)
      .flatMap((references) => references)
      .map((reference) => [reference.alias, reference] as const),
  );
}

export function validateMindMapGenerationCandidate(
  value: JsonValue,
  context: MindMapGenerationCandidateValidationContext,
) {
  const issues: GenerationValidationIssue[] = [];

  if (
    !isRecord(value) ||
    value.format !== MIND_MAP_GENERATION_CANDIDATE_FORMAT ||
    value.version !== MIND_MAP_GENERATION_CANDIDATE_VERSION ||
    !normalizedRequiredText(value.title) ||
    !normalizedRequiredText(value.rootNodeId) ||
    !isRecord(value.nodes) ||
    !isRecord(value.frames)
  ) {
    return generationValidationFailure<MindMapGenerationCandidate>([
      { path: 'output', message: 'Mind Map candidate 顶层结构无效' },
    ]);
  }

  const title = normalizedRequiredText(value.title)!;
  const rootNodeId = normalizedRequiredText(value.rootNodeId)!;
  const nodes: Record<string, MindMapGenerationCandidateNode> =
    Object.fromEntries(
    Object.entries(value.nodes).flatMap(([nodeId, node]) => {
      const cloned = cloneCandidateNode(node);
      if (!cloned || cloned.id !== nodeId) {
        issues.push({
          path: `output.nodes.${nodeId}`,
          message: 'Mind Map node 数据无效、缺少来源 Target 或 ID 与键不一致',
        });
        return [];
      }
      return [[nodeId, cloned]];
    }),
  );
  const frames: Record<string, MindMapGenerationCandidateFrame> =
    Object.fromEntries(
    Object.entries(value.frames).flatMap(([frameId, frame]) => {
      const cloned = cloneCandidateFrame(frame);
      if (!cloned || cloned.id !== frameId) {
        issues.push({
          path: `output.frames.${frameId}`,
          message: 'Mind Map frame 数据无效、缺少来源 Target 或 ID 与键不一致',
        });
        return [];
      }
      return [[frameId, cloned]];
    }),
  );

  if (issues.length > 0) {
    return generationValidationFailure<MindMapGenerationCandidate>(issues);
  }

  if (
    !isMindMapDocument({
      format: MIND_MAP_DOCUMENT_FORMAT,
      version: MIND_MAP_DOCUMENT_VERSION,
      title,
      rootNodeId,
      nodes: Object.fromEntries(
        Object.entries(nodes).map(([nodeId, node]) => [nodeId, {
          id: node.id,
          title: node.title,
          focus: node.focus,
          childIds: node.childIds,
        }]),
      ),
      frames: Object.fromEntries(
        Object.entries(frames).map(([frameId, frame]) => [frameId, {
          id: frame.id,
          title: frame.title,
          nodeIds: frame.nodeIds,
        }]),
      ),
      associations: { nodes: {}, frames: {} },
    })
  ) {
    issues.push({
      path: 'output',
      message: 'Mind Map candidate 必须形成严格树且 Frame 引用有效节点',
    });
  }

  const preparedByAlias = referencesByAlias(context.assetReferences);
  const validateReferences = (
    subjectKind: 'nodes' | 'frames',
    subjects: Readonly<Record<
      string,
      MindMapGenerationCandidateNode | MindMapGenerationCandidateFrame
    >>,
  ) => {
    for (const [subjectId, subject] of Object.entries(subjects)) {
      subject.sourceReferences.forEach((reference, index) => {
        const prepared = preparedByAlias.get(reference.sourceAlias);
        if (!prepared) {
          issues.push({
            path: `output.${subjectKind}.${subjectId}.sourceReferences.${index}.sourceAlias`,
            message: `引用了未知来源 alias：${reference.sourceAlias}`,
          });
          return;
        }
        if (
          !prepared.workbenchId ||
          !context.targets.validate(prepared.workbenchId, reference.target)
        ) {
          issues.push({
            path: `output.${subjectKind}.${subjectId}.sourceReferences.${index}.target`,
            message: `Target 不属于来源 ${reference.sourceAlias} 的 Workbench，或 payload 无效`,
          });
        }
      });
    }
  };
  validateReferences('nodes', nodes);
  validateReferences('frames', frames);

  if (issues.length > 0) {
    return generationValidationFailure<MindMapGenerationCandidate>(issues);
  }

  return generationValidationSuccess(Object.freeze({
    format: MIND_MAP_GENERATION_CANDIDATE_FORMAT,
    version: MIND_MAP_GENERATION_CANDIDATE_VERSION,
    title,
    rootNodeId,
    nodes: Object.freeze(nodes),
    frames: Object.freeze(frames),
  }));
}
