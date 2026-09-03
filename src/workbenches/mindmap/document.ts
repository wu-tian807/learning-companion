import {
  cloneAssetTarget,
  isAssetTarget,
  type AssetTarget,
} from '../../shared/workbench/asset-target';

export const MIND_MAP_DOCUMENT_FORMAT = 'learning-companion/mindmap';
export const MIND_MAP_DOCUMENT_VERSION = 3;

export interface MindMapNode {
  readonly id: string;
  readonly title: string;
  readonly focus: string;
  readonly childIds: readonly string[];
}

export interface MindMapFrame {
  readonly id: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
}

export interface MindMapReferenceBinding {
  readonly referenceId: string;
  readonly sourceRevision: string;
  readonly target: AssetTarget;
}

export interface MindMapSubjectAssociations {
  readonly references: readonly MindMapReferenceBinding[];
  readonly linkIds: readonly string[];
}

export interface MindMapAssociations {
  readonly nodes: Readonly<Record<string, MindMapSubjectAssociations>>;
  readonly frames: Readonly<Record<string, MindMapSubjectAssociations>>;
}

export interface MindMapDocument {
  readonly format: typeof MIND_MAP_DOCUMENT_FORMAT;
  readonly version: typeof MIND_MAP_DOCUMENT_VERSION;
  readonly title: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, MindMapNode>>;
  readonly frames: Readonly<Record<string, MindMapFrame>>;
  readonly associations: MindMapAssociations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNormalizedId(value: unknown): value is string {
  return isRequiredText(value) && value === value.trim();
}

function isMindMapNode(value: unknown): value is MindMapNode {
  return (
    isRecord(value) &&
    isNormalizedId(value.id) &&
    isRequiredText(value.title) &&
    isRequiredText(value.focus) &&
    Array.isArray(value.childIds) &&
    value.childIds.every(isNormalizedId) &&
    new Set(value.childIds).size === value.childIds.length
  );
}

function isMindMapFrame(value: unknown): value is MindMapFrame {
  return (
    isRecord(value) &&
    isNormalizedId(value.id) &&
    isRequiredText(value.title) &&
    Array.isArray(value.nodeIds) &&
    value.nodeIds.length > 0 &&
    value.nodeIds.every(isNormalizedId) &&
    new Set(value.nodeIds).size === value.nodeIds.length
  );
}

function hasValidTree(
  rootNodeId: string,
  nodes: Readonly<Record<string, MindMapNode>>,
): boolean {
  if (!Object.hasOwn(nodes, rootNodeId)) {
    return false;
  }

  const parentCounts = new Map(
    Object.keys(nodes).map((nodeId) => [nodeId, 0]),
  );

  for (const node of Object.values(nodes)) {
    for (const childId of node.childIds) {
      const parentCount = parentCounts.get(childId);
      if (parentCount === undefined) {
        return false;
      }
      parentCounts.set(childId, parentCount + 1);
    }
  }

  for (const [nodeId, parentCount] of parentCounts) {
    if (
      (nodeId === rootNodeId && parentCount !== 0) ||
      (nodeId !== rootNodeId && parentCount !== 1)
    ) {
      return false;
    }
  }

  const visited = new Set<string>();
  const pending = [rootNodeId];

  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || visited.has(nodeId)) {
      return false;
    }
    visited.add(nodeId);
    pending.push(...nodes[nodeId].childIds);
  }

  return visited.size === Object.keys(nodes).length;
}

function hasValidFrames(
  nodes: Readonly<Record<string, MindMapNode>>,
  frames: Readonly<Record<string, MindMapFrame>>,
): boolean {
  return Object.entries(frames).every(
    ([frameId, frame]) =>
      isNormalizedId(frameId) &&
      isMindMapFrame(frame) &&
      frame.id === frameId &&
      frame.nodeIds.every((nodeId) => Object.hasOwn(nodes, nodeId)),
  );
}

function isMindMapReferenceBinding(
  value: unknown,
): value is MindMapReferenceBinding {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['referenceId', 'sourceRevision', 'target']) &&
    isNormalizedId(value.referenceId) &&
    isNormalizedId(value.sourceRevision) &&
    isAssetTarget(value.target)
  );
}

function isMindMapSubjectAssociations(
  value: unknown,
): value is MindMapSubjectAssociations {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['references', 'linkIds']) &&
    Array.isArray(value.references) &&
    value.references.every(isMindMapReferenceBinding) &&
    Array.isArray(value.linkIds) &&
    value.linkIds.every(isNormalizedId) &&
    new Set(value.linkIds).size === value.linkIds.length
  );
}

function hasValidSubjectAssociations(
  subjects: Readonly<Record<string, unknown>>,
  associations: Readonly<Record<string, MindMapSubjectAssociations>>,
): boolean {
  return Object.entries(associations).every(
    ([subjectId, subjectAssociations]) =>
      Object.hasOwn(subjects, subjectId) &&
      isMindMapSubjectAssociations(subjectAssociations),
  );
}

export function isMindMapDocument(
  value: unknown,
): value is MindMapDocument {
  if (
    !isRecord(value) ||
    value.format !== MIND_MAP_DOCUMENT_FORMAT ||
    value.version !== MIND_MAP_DOCUMENT_VERSION ||
    !isRequiredText(value.title) ||
    !isNormalizedId(value.rootNodeId) ||
    !isRecord(value.nodes) ||
    !isRecord(value.frames) ||
    !isRecord(value.associations) ||
    !isRecord(value.associations.nodes) ||
    !isRecord(value.associations.frames)
  ) {
    return false;
  }

  const nodeEntries = Object.entries(value.nodes);
  if (
    nodeEntries.length === 0 ||
    nodeEntries.some(
      ([nodeId, node]) =>
        !isNormalizedId(nodeId) ||
        !isMindMapNode(node) ||
        node.id !== nodeId,
    )
  ) {
    return false;
  }

  const nodes = value.nodes as Readonly<Record<string, MindMapNode>>;
  const frames = value.frames as Readonly<Record<string, MindMapFrame>>;
  const associations = value.associations as unknown as MindMapAssociations;

  return (
    hasValidTree(value.rootNodeId, nodes) &&
    hasValidFrames(nodes, frames) &&
    hasValidSubjectAssociations(nodes, associations.nodes) &&
    hasValidSubjectAssociations(frames, associations.frames)
  );
}

function cloneSubjectAssociations(
  associations: MindMapSubjectAssociations,
): MindMapSubjectAssociations {
  return Object.freeze({
    references: Object.freeze(
      associations.references.map((binding) =>
        Object.freeze({
          referenceId: binding.referenceId,
          sourceRevision: binding.sourceRevision,
          target: cloneAssetTarget(binding.target),
        }),
      ),
    ),
    linkIds: Object.freeze([...associations.linkIds]),
  });
}

function cloneSubjectAssociationMap(
  associations: Readonly<Record<string, MindMapSubjectAssociations>>,
): Readonly<Record<string, MindMapSubjectAssociations>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(associations).map(([subjectId, subjectAssociations]) => [
        subjectId,
        cloneSubjectAssociations(subjectAssociations),
      ]),
    ),
  );
}

export function cloneMindMapDocument(
  document: MindMapDocument,
): MindMapDocument {
  if (!isMindMapDocument(document)) {
    throw new Error('MindMapDocument 数据无效');
  }

  return Object.freeze({
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION,
    title: document.title.trim(),
    rootNodeId: document.rootNodeId,
    nodes: Object.freeze(
      Object.fromEntries(
        Object.entries(document.nodes).map(([nodeId, node]) => [
          nodeId,
          Object.freeze({
            id: node.id,
            title: node.title.trim(),
            focus: node.focus.trim(),
            childIds: Object.freeze([...node.childIds]),
          }),
        ]),
      ),
    ),
    frames: Object.freeze(
      Object.fromEntries(
        Object.entries(document.frames).map(([frameId, frame]) => [
          frameId,
          Object.freeze({
            id: frame.id,
            title: frame.title.trim(),
            nodeIds: Object.freeze([...frame.nodeIds]),
          }),
        ]),
      ),
    ),
    associations: Object.freeze({
      nodes: cloneSubjectAssociationMap(document.associations.nodes),
      frames: cloneSubjectAssociationMap(document.associations.frames),
    }),
  });
}
