import {
  cloneAssetTarget,
  isAssetTarget,
  type AssetTarget,
  type ContentAnchorTarget,
} from '../../shared/workbench/anchor';

export const MIND_MAP_MEDIA_TYPE =
  'application/vnd.learning-companion.mindmap+json';
export const MIND_MAP_DOCUMENT_FORMAT = 'learning-companion/mindmap';
export const MIND_MAP_DOCUMENT_VERSION = 1;
export const MIND_MAP_NODE_ANCHOR_TYPE = 'mindmap.node';
export const MIND_MAP_NODE_ANCHOR_VERSION = 1;

export interface MindMapNodeV1 {
  readonly id: string;
  readonly title: string;
  readonly focus: string;
  readonly childIds: readonly string[];
}

export interface MindMapNodeReferenceBindingV1 {
  readonly referenceId: string;
  readonly sourceTarget: AssetTarget;
}

export interface MindMapNodeAssociationsV1 {
  readonly references: readonly MindMapNodeReferenceBindingV1[];
  readonly linkIds: readonly string[];
}

export interface MindMapDocumentV1 {
  readonly format: typeof MIND_MAP_DOCUMENT_FORMAT;
  readonly version: typeof MIND_MAP_DOCUMENT_VERSION;
  readonly title: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, MindMapNodeV1>>;
  readonly nodeAssociations: Readonly<
    Record<string, MindMapNodeAssociationsV1>
  >;
}

export interface MindMapNodeAnchorPayloadV1 {
  readonly nodeId: string;
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

function isMindMapNodeReferenceBindingV1(
  value: unknown,
): value is MindMapNodeReferenceBindingV1 {
  return (
    isRecord(value) &&
    isNormalizedId(value.referenceId) &&
    isAssetTarget(value.sourceTarget)
  );
}

function isMindMapNodeAssociationsV1(
  value: unknown,
): value is MindMapNodeAssociationsV1 {
  return (
    isRecord(value) &&
    Array.isArray(value.references) &&
    value.references.every(isMindMapNodeReferenceBindingV1) &&
    Array.isArray(value.linkIds) &&
    value.linkIds.every(isNormalizedId) &&
    new Set(value.linkIds).size === value.linkIds.length
  );
}

function hasValidNodeAssociations(
  nodes: Readonly<Record<string, MindMapNodeV1>>,
  nodeAssociations: Readonly<Record<string, MindMapNodeAssociationsV1>>,
): boolean {
  const nodeIds = Object.keys(nodes);
  const associatedNodeIds = Object.keys(nodeAssociations);

  if (
    associatedNodeIds.length !== nodeIds.length ||
    associatedNodeIds.some((nodeId) => !Object.hasOwn(nodes, nodeId))
  ) {
    return false;
  }

  return nodeIds.every((nodeId) =>
    isMindMapNodeAssociationsV1(nodeAssociations[nodeId]),
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
    !isRecord(value.nodeAssociations)
  ) {
    return false;
  }

  const entries = Object.entries(value.nodes);

  if (
    entries.length === 0 ||
    entries.some(
      ([nodeId, node]) =>
        !isNormalizedId(nodeId) ||
        !isMindMapNodeV1(node) ||
        node.id !== nodeId,
    )
  ) {
    return false;
  }

  const nodes = value.nodes as Readonly<Record<string, MindMapNodeV1>>;
  const nodeAssociations = value.nodeAssociations as Readonly<
    Record<string, MindMapNodeAssociationsV1>
  >;

  return (
    hasValidTree(value.rootNodeId, nodes) &&
    hasValidNodeAssociations(nodes, nodeAssociations)
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
  const nodeAssociations = Object.freeze(
    Object.fromEntries(
      Object.entries(document.nodeAssociations).map(
        ([nodeId, associations]) => [
          nodeId,
          Object.freeze({
            references: Object.freeze(
              associations.references.map((binding) =>
                Object.freeze({
                  referenceId: binding.referenceId,
                  sourceTarget: cloneAssetTarget(binding.sourceTarget),
                }),
              ),
            ),
            linkIds: Object.freeze([...associations.linkIds]),
          }),
        ],
      ),
    ),
  );

  return Object.freeze({
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION,
    title: document.title.trim(),
    rootNodeId: document.rootNodeId,
    nodes,
    nodeAssociations,
  });
}

export function createMindMapNodeTarget(
  nodeId: string,
): ContentAnchorTarget {
  if (!isNormalizedId(nodeId)) {
    throw new Error('Mind Map nodeId 无效');
  }

  return Object.freeze({
    scope: 'content',
    anchorType: MIND_MAP_NODE_ANCHOR_TYPE,
    anchorVersion: MIND_MAP_NODE_ANCHOR_VERSION,
    anchorPayload: Object.freeze({ nodeId }),
  });
}

export function isMindMapNodeTarget(
  value: unknown,
): value is ContentAnchorTarget & {
  readonly anchorPayload: MindMapNodeAnchorPayloadV1;
} {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.scope === 'content' &&
    value.anchorType === MIND_MAP_NODE_ANCHOR_TYPE &&
    value.anchorVersion === MIND_MAP_NODE_ANCHOR_VERSION &&
    isRecord(value.anchorPayload) &&
    isNormalizedId(value.anchorPayload.nodeId)
  );
}
