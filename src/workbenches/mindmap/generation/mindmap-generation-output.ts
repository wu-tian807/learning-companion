import type { JsonValue } from '../../../shared/workbench/protocol';
import type { PreparedGenerationAssetReferenceBindings } from '../../../main/generation/contracts/generation-asset-reference';
import {
  generationValidationFailure,
  generationValidationSuccess,
  type GenerationValidationIssue,
} from '../../../main/generation/contracts/generation-validation';
import { isMindMapDocumentV1 } from '../document';

export const MIND_MAP_GENERATION_CANDIDATE_FORMAT =
  'learning-companion/mindmap-generation-candidate';
export const MIND_MAP_GENERATION_CANDIDATE_VERSION = 1;
export const MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH =
  'output/mindmap-candidate.json';

export interface MindMapGenerationCandidateNodeV1 {
  readonly id: string;
  readonly title: string;
  readonly focus: string;
  readonly childIds: readonly string[];
  readonly sourceAliases: readonly string[];
}

export interface MindMapGenerationCandidateFrameV1 {
  readonly id: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
  readonly sourceAliases: readonly string[];
}

export interface MindMapGenerationCandidateV1 {
  readonly format: typeof MIND_MAP_GENERATION_CANDIDATE_FORMAT;
  readonly version: typeof MIND_MAP_GENERATION_CANDIDATE_VERSION;
  readonly title: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, MindMapGenerationCandidateNodeV1>>;
  readonly frames: Readonly<Record<string, MindMapGenerationCandidateFrameV1>>;
}

export interface MindMapGenerationCandidateValidationContext {
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUniqueTextList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(isRequiredText) &&
    new Set(value).size === value.length
  );
}

function cloneCandidateNode(
  value: unknown,
): MindMapGenerationCandidateNodeV1 | undefined {
  if (
    !isRecord(value) ||
    !isRequiredText(value.id) ||
    !isRequiredText(value.title) ||
    !isRequiredText(value.focus) ||
    !isUniqueTextList(value.childIds) ||
    !isUniqueTextList(value.sourceAliases)
  ) {
    return undefined;
  }

  return Object.freeze({
    id: value.id.trim(),
    title: value.title.trim(),
    focus: value.focus.trim(),
    childIds: Object.freeze(value.childIds.map((id) => id.trim())),
    sourceAliases: Object.freeze(
      value.sourceAliases.map((alias) => alias.trim()),
    ),
  });
}

function cloneCandidateFrame(
  value: unknown,
): MindMapGenerationCandidateFrameV1 | undefined {
  if (
    !isRecord(value) ||
    !isRequiredText(value.id) ||
    !isRequiredText(value.title) ||
    !isUniqueTextList(value.nodeIds) ||
    value.nodeIds.length === 0 ||
    !isUniqueTextList(value.sourceAliases)
  ) {
    return undefined;
  }

  return Object.freeze({
    id: value.id.trim(),
    title: value.title.trim(),
    nodeIds: Object.freeze(value.nodeIds.map((id) => id.trim())),
    sourceAliases: Object.freeze(
      value.sourceAliases.map((alias) => alias.trim()),
    ),
  });
}

function availableSourceAliases(
  context: MindMapGenerationCandidateValidationContext,
): ReadonlySet<string> {
  return new Set(
    Object.values(context.assetReferences).flatMap((references) =>
      references.map(({ alias }) => alias),
    ),
  );
}

export function validateMindMapGenerationCandidateV1(
  value: JsonValue,
  context: MindMapGenerationCandidateValidationContext,
) {
  const issues: GenerationValidationIssue[] = [];

  if (
    !isRecord(value) ||
    value.format !== MIND_MAP_GENERATION_CANDIDATE_FORMAT ||
    value.version !== MIND_MAP_GENERATION_CANDIDATE_VERSION ||
    !isRequiredText(value.title) ||
    !isRequiredText(value.rootNodeId) ||
    !isRecord(value.nodes) ||
    !isRecord(value.frames)
  ) {
    return generationValidationFailure<MindMapGenerationCandidateV1>([
      { path: 'output', message: 'Mind Map candidate 顶层结构无效' },
    ]);
  }

  const nodes = Object.fromEntries(
    Object.entries(value.nodes).flatMap(([nodeId, node]) => {
      const cloned = cloneCandidateNode(node);

      if (!cloned || cloned.id !== nodeId) {
        issues.push({
          path: `output.nodes.${nodeId}`,
          message: 'Mind Map node 数据无效或 ID 与键不一致',
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
          message: 'Mind Map frame 数据无效或 ID 与键不一致',
        });
        return [];
      }

      return [[frameId, cloned]];
    }),
  );

  if (issues.length > 0) {
    return generationValidationFailure<MindMapGenerationCandidateV1>(issues);
  }

  if (
    !isMindMapDocumentV1({
      format: 'learning-companion/mindmap',
      version: 1,
      title: value.title,
      rootNodeId: value.rootNodeId,
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
      for (const alias of subject.sourceAliases) {
        if (!aliases.has(alias)) {
          issues.push({
            path: `output.${subjectKind}.${subjectId}.sourceAliases`,
            message: `引用了未知来源 alias：${alias}`,
          });
        }
      }
    }
  }

  if (issues.length > 0) {
    return generationValidationFailure<MindMapGenerationCandidateV1>(issues);
  }

  return generationValidationSuccess(
    Object.freeze({
      format: MIND_MAP_GENERATION_CANDIDATE_FORMAT,
      version: MIND_MAP_GENERATION_CANDIDATE_VERSION,
      title: value.title.trim(),
      rootNodeId: value.rootNodeId.trim(),
      nodes: Object.freeze(nodes),
      frames: Object.freeze(frames),
    }),
  );
}
