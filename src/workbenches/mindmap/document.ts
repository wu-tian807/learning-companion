import {
  cloneAssetTarget,
  isAssetTarget,
  type AssetTarget,
} from '../../shared/workbench/anchor';

export const MIND_MAP_DOCUMENT_FORMAT = 'learning-companion/mindmap';
export const MIND_MAP_DOCUMENT_VERSION = 1;

export interface MindMapNodeV1 {
  readonly id: string;
  readonly title: string;
  readonly focus: string;
  readonly childIds: readonly string[];
}

export interface MindMapFrameV1 {
  readonly id: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
}

export interface MindMapReferenceBindingV1 {
  readonly referenceId: string;
  readonly sourceTarget: AssetTarget;
}

export interface MindMapSubjectAssociationsV1 {
  readonly references: readonly MindMapReferenceBindingV1[];
  readonly linkIds: readonly string[];
}

export interface MindMapAssociationsV1 {
  readonly nodes: Readonly<
    Record<string, MindMapSubjectAssociationsV1>
  >;
  readonly frames: Readonly<
    Record<string, MindMapSubjectAssociationsV1>
  >;
}

export interface MindMapDocumentV1 {
  readonly format: typeof MIND_MAP_DOCUMENT_FORMAT;
  readonly version: typeof MIND_MAP_DOCUMENT_VERSION;
  readonly title: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, MindMapNodeV1>>;
  readonly frames: Readonly<Record<string, MindMapFrameV1>>;
  readonly associations: MindMapAssociationsV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNormalizedId(value: unknown): value is string {
  return isRequiredText(value) && value === value.trim();
}

function isMindMapNodeV1(value: unknown): value is MindMapNodeV1 {
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

function isMindMapFrameV1(value: unknown): value is MindMapFrameV1 {
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
  nodes: Readonly<Record<string, MindMapNodeV1>>,
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
  nodes: Readonly<Record<string, MindMapNodeV1>>,
  frames: Readonly<Record<string, MindMapFrameV1>>,
): boolean {
  return Object.entries(frames).every(
    ([frameId, frame]) =>
      isNormalizedId(frameId) &&
      isMindMapFrameV1(frame) &&
      frame.id === frameId &&
      frame.nodeIds.every((nodeId) => Object.hasOwn(nodes, nodeId)),
  );
}

function isMindMapReferenceBindingV1(
  value: unknown,
): value is MindMapReferenceBindingV1 {
  return (
    isRecord(value) &&
    isNormalizedId(value.referenceId) &&
    isAssetTarget(value.sourceTarget)
  );
}

function isMindMapSubjectAssociationsV1(
  value: unknown,
): value is MindMapSubjectAssociationsV1 {
  if (
    !isRecord(value) ||
    !Array.isArray(value.references) ||
    !value.references.every(isMindMapReferenceBindingV1) ||
    !Array.isArray(value.linkIds) ||
    !value.linkIds.every(isNormalizedId)
  ) {
    return false;
  }

  const referenceIds = value.references.map(
    ({ referenceId }) => referenceId,
  );

  return (
    new Set(referenceIds).size === referenceIds.length &&
    new Set(value.linkIds).size === value.linkIds.length
  );
}

function hasValidSubjectAssociations(
  subjects: Readonly<Record<string, unknown>>,
  associations: Readonly<
    Record<string, MindMapSubjectAssociationsV1>
  >,
): boolean {
  return Object.entries(associations).every(
    ([subjectId, subjectAssociations]) =>
      Object.hasOwn(subjects, subjectId) &&
      isMindMapSubjectAssociationsV1(subjectAssociations),
  );
}

function hasValidAssociations(
  nodes: Readonly<Record<string, MindMapNodeV1>>,
  frames: Readonly<Record<string, MindMapFrameV1>>,
  associations: MindMapAssociationsV1,
): boolean {
  return (
    hasValidSubjectAssociations(nodes, associations.nodes) &&
    hasValidSubjectAssociations(frames, associations.frames)
  );
}

export function isMindMapDocumentV1(
  value: unknown,
): value is MindMapDocumentV1 {
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
        !isMindMapNodeV1(node) ||
        node.id !== nodeId,
    )
  ) {
    return false;
  }

  const nodes = value.nodes as Readonly<Record<string, MindMapNodeV1>>;
  const frames = value.frames as Readonly<Record<string, MindMapFrameV1>>;
  const associations = value.associations as unknown as MindMapAssociationsV1;

  return (
    hasValidTree(value.rootNodeId, nodes) &&
    hasValidFrames(nodes, frames) &&
    hasValidAssociations(nodes, frames, associations)
  );
}

function cloneMindMapSubjectAssociationsV1(
  associations: MindMapSubjectAssociationsV1,
): MindMapSubjectAssociationsV1 {
  return Object.freeze({
    references: Object.freeze(
      associations.references.map((binding) =>
        Object.freeze({
          referenceId: binding.referenceId,
          sourceTarget: cloneAssetTarget(binding.sourceTarget),
        }),
      ),
    ),
    linkIds: Object.freeze([...associations.linkIds]),
  });
}

function cloneMindMapSubjectAssociationMap(
  associations: Readonly<
    Record<string, MindMapSubjectAssociationsV1>
  >,
): Readonly<Record<string, MindMapSubjectAssociationsV1>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(associations).map(
        ([subjectId, subjectAssociations]) => [
          subjectId,
          cloneMindMapSubjectAssociationsV1(subjectAssociations),
        ],
      ),
    ),
  );
}

export function cloneMindMapDocumentV1(
  document: MindMapDocumentV1,
): MindMapDocumentV1 {
  if (!isMindMapDocumentV1(document)) {
    throw new Error('MindMapDocumentV1 数据无效');
  }

  const nodes = Object.freeze(
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
  );
  const frames = Object.freeze(
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
  );
  const associations = Object.freeze({
    nodes: cloneMindMapSubjectAssociationMap(
      document.associations.nodes,
    ),
    frames: cloneMindMapSubjectAssociationMap(
      document.associations.frames,
    ),
  });

  return Object.freeze({
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION,
    title: document.title.trim(),
    rootNodeId: document.rootNodeId,
    nodes,
    frames,
    associations,
  });
}
