import {
  cloneAssetTarget,
  parseAssetTarget,
  type AssetTarget,
} from '../../shared/workbench/asset-target';
import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../shared/workbench/protocol';

export const MIND_MAP_DOCUMENT_FORMAT = 'learning-companion/mindmap';
export const MIND_MAP_DOCUMENT_VERSION = 1;
export const MIND_MAP_DOCUMENT_VERSION_V2 = 2;
export const MIND_MAP_DOCUMENT_VERSION_V3 = 3;

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

/** Agent-interpreted source locator. Field semantics intentionally stay open. */
export type MindMapAgentLocatorV1 = Readonly<
  Record<string, JsonValue>
>;

export interface MindMapReferenceBindingV2 {
  readonly referenceId: string;
  readonly sourceRevision: string;
  readonly agentLocator: MindMapAgentLocatorV1;
}

export interface MindMapReferenceBindingV3 {
  readonly referenceId: string;
  readonly sourceRevision: string;
  readonly target: AssetTarget;
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

export interface MindMapSubjectAssociationsV2 {
  readonly references: readonly MindMapReferenceBindingV2[];
  readonly linkIds: readonly string[];
}

export interface MindMapAssociationsV2 {
  readonly nodes: Readonly<
    Record<string, MindMapSubjectAssociationsV2>
  >;
  readonly frames: Readonly<
    Record<string, MindMapSubjectAssociationsV2>
  >;
}

export interface MindMapSubjectAssociationsV3 {
  readonly references: readonly MindMapReferenceBindingV3[];
  readonly linkIds: readonly string[];
}

export interface MindMapAssociationsV3 {
  readonly nodes: Readonly<Record<string, MindMapSubjectAssociationsV3>>;
  readonly frames: Readonly<Record<string, MindMapSubjectAssociationsV3>>;
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

export interface MindMapDocumentV2 {
  readonly format: typeof MIND_MAP_DOCUMENT_FORMAT;
  readonly version: typeof MIND_MAP_DOCUMENT_VERSION_V2;
  readonly title: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, MindMapNodeV1>>;
  readonly frames: Readonly<Record<string, MindMapFrameV1>>;
  readonly associations: MindMapAssociationsV2;
}

export interface MindMapDocumentV3 {
  readonly format: typeof MIND_MAP_DOCUMENT_FORMAT;
  readonly version: typeof MIND_MAP_DOCUMENT_VERSION_V3;
  readonly title: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, MindMapNodeV1>>;
  readonly frames: Readonly<Record<string, MindMapFrameV1>>;
  readonly associations: MindMapAssociationsV3;
}

export type MindMapDocument =
  | MindMapDocumentV1
  | MindMapDocumentV2
  | MindMapDocumentV3;

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
    parseAssetTarget(value.sourceTarget) !== undefined
  );
}

export function isMindMapAgentLocatorV1(
  value: unknown,
): value is MindMapAgentLocatorV1 {
  return (
    isRecord(value) &&
    Object.keys(value).length > 0 &&
    isJsonValue(value)
  );
}

function isMindMapReferenceBindingV2(
  value: unknown,
): value is MindMapReferenceBindingV2 {
  return (
    isRecord(value) &&
    isNormalizedId(value.referenceId) &&
    isNormalizedId(value.sourceRevision) &&
    isMindMapAgentLocatorV1(value.agentLocator)
  );
}

function isMindMapReferenceBindingV3(
  value: unknown,
): value is MindMapReferenceBindingV3 {
  return (
    isRecord(value) &&
    isNormalizedId(value.referenceId) &&
    isNormalizedId(value.sourceRevision) &&
    parseAssetTarget(value.target) !== undefined
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

function isMindMapSubjectAssociationsV2(
  value: unknown,
): value is MindMapSubjectAssociationsV2 {
  return (
    isRecord(value) &&
    Array.isArray(value.references) &&
    value.references.every(isMindMapReferenceBindingV2) &&
    Array.isArray(value.linkIds) &&
    value.linkIds.every(isNormalizedId) &&
    new Set(value.linkIds).size === value.linkIds.length
  );
}

function isMindMapSubjectAssociationsV3(
  value: unknown,
): value is MindMapSubjectAssociationsV3 {
  return (
    isRecord(value) &&
    Array.isArray(value.references) &&
    value.references.every(isMindMapReferenceBindingV3) &&
    Array.isArray(value.linkIds) &&
    value.linkIds.every(isNormalizedId) &&
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

function hasValidSubjectAssociationsV2(
  subjects: Readonly<Record<string, unknown>>,
  associations: Readonly<
    Record<string, MindMapSubjectAssociationsV2>
  >,
): boolean {
  return Object.entries(associations).every(
    ([subjectId, subjectAssociations]) =>
      Object.hasOwn(subjects, subjectId) &&
      isMindMapSubjectAssociationsV2(subjectAssociations),
  );
}

function hasValidAssociationsV2(
  nodes: Readonly<Record<string, MindMapNodeV1>>,
  frames: Readonly<Record<string, MindMapFrameV1>>,
  associations: MindMapAssociationsV2,
): boolean {
  return (
    hasValidSubjectAssociationsV2(nodes, associations.nodes) &&
    hasValidSubjectAssociationsV2(frames, associations.frames)
  );
}

function hasValidAssociationsV3(
  nodes: Readonly<Record<string, MindMapNodeV1>>,
  frames: Readonly<Record<string, MindMapFrameV1>>,
  associations: MindMapAssociationsV3,
): boolean {
  const valid = (
    subjects: Readonly<Record<string, unknown>>,
    values: Readonly<Record<string, MindMapSubjectAssociationsV3>>,
  ) => Object.entries(values).every(
    ([subjectId, subjectAssociations]) =>
      Object.hasOwn(subjects, subjectId) &&
      isMindMapSubjectAssociationsV3(subjectAssociations),
  );

  return valid(nodes, associations.nodes) && valid(frames, associations.frames);
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

export function isMindMapDocumentV2(
  value: unknown,
): value is MindMapDocumentV2 {
  if (
    !isRecord(value) ||
    value.format !== MIND_MAP_DOCUMENT_FORMAT ||
    value.version !== MIND_MAP_DOCUMENT_VERSION_V2 ||
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
  const associations = value.associations as unknown as MindMapAssociationsV2;

  return (
    hasValidTree(value.rootNodeId, nodes) &&
    hasValidFrames(nodes, frames) &&
    hasValidAssociationsV2(nodes, frames, associations)
  );
}

export function isMindMapDocumentV3(
  value: unknown,
): value is MindMapDocumentV3 {
  if (
    !isRecord(value) ||
    value.format !== MIND_MAP_DOCUMENT_FORMAT ||
    value.version !== MIND_MAP_DOCUMENT_VERSION_V3 ||
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
  const associations = value.associations as unknown as MindMapAssociationsV3;

  return (
    hasValidTree(value.rootNodeId, nodes) &&
    hasValidFrames(nodes, frames) &&
    hasValidAssociationsV3(nodes, frames, associations)
  );
}

export function isMindMapDocument(
  value: unknown,
): value is MindMapDocument {
  return (
    isMindMapDocumentV1(value) ||
    isMindMapDocumentV2(value) ||
    isMindMapDocumentV3(value)
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
          sourceTarget: cloneAssetTarget(parseAssetTarget(binding.sourceTarget)!),
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

export function cloneMindMapAgentLocatorV1(
  locator: MindMapAgentLocatorV1,
): MindMapAgentLocatorV1 {
  if (!isMindMapAgentLocatorV1(locator)) {
    throw new Error('Mind Map Agent locator 数据无效');
  }

  return cloneJsonValue(locator) as MindMapAgentLocatorV1;
}

function cloneMindMapSubjectAssociationsV2(
  associations: MindMapSubjectAssociationsV2,
): MindMapSubjectAssociationsV2 {
  return Object.freeze({
    references: Object.freeze(
      associations.references.map((binding) =>
        Object.freeze({
          referenceId: binding.referenceId,
          sourceRevision: binding.sourceRevision,
          agentLocator: cloneMindMapAgentLocatorV1(
            binding.agentLocator,
          ),
        }),
      ),
    ),
    linkIds: Object.freeze([...associations.linkIds]),
  });
}

function cloneMindMapSubjectAssociationMapV2(
  associations: Readonly<
    Record<string, MindMapSubjectAssociationsV2>
  >,
): Readonly<Record<string, MindMapSubjectAssociationsV2>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(associations).map(
        ([subjectId, subjectAssociations]) => [
          subjectId,
          cloneMindMapSubjectAssociationsV2(subjectAssociations),
        ],
      ),
    ),
  );
}

function cloneMindMapSubjectAssociationsV3(
  associations: MindMapSubjectAssociationsV3,
): MindMapSubjectAssociationsV3 {
  return Object.freeze({
    references: Object.freeze(
      associations.references.map((binding) =>
        Object.freeze({
          referenceId: binding.referenceId,
          sourceRevision: binding.sourceRevision,
          target: cloneAssetTarget(parseAssetTarget(binding.target)!),
        }),
      ),
    ),
    linkIds: Object.freeze([...associations.linkIds]),
  });
}

function cloneMindMapSubjectAssociationMapV3(
  associations: Readonly<Record<string, MindMapSubjectAssociationsV3>>,
): Readonly<Record<string, MindMapSubjectAssociationsV3>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(associations).map(([subjectId, subjectAssociations]) => [
        subjectId,
        cloneMindMapSubjectAssociationsV3(subjectAssociations),
      ]),
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

export function cloneMindMapDocumentV2(
  document: MindMapDocumentV2,
): MindMapDocumentV2 {
  if (!isMindMapDocumentV2(document)) {
    throw new Error('MindMapDocumentV2 数据无效');
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
    nodes: cloneMindMapSubjectAssociationMapV2(
      document.associations.nodes,
    ),
    frames: cloneMindMapSubjectAssociationMapV2(
      document.associations.frames,
    ),
  });

  return Object.freeze({
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION_V2,
    title: document.title.trim(),
    rootNodeId: document.rootNodeId,
    nodes,
    frames,
    associations,
  });
}

export function cloneMindMapDocumentV3(
  document: MindMapDocumentV3,
): MindMapDocumentV3 {
  if (!isMindMapDocumentV3(document)) {
    throw new Error('MindMapDocumentV3 数据无效');
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

  return Object.freeze({
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION_V3,
    title: document.title.trim(),
    rootNodeId: document.rootNodeId,
    nodes,
    frames,
    associations: Object.freeze({
      nodes: cloneMindMapSubjectAssociationMapV3(document.associations.nodes),
      frames: cloneMindMapSubjectAssociationMapV3(document.associations.frames),
    }),
  });
}

export function cloneMindMapDocument(
  document: MindMapDocument,
): MindMapDocument {
  if (document.version === MIND_MAP_DOCUMENT_VERSION) {
    return cloneMindMapDocumentV1(document);
  }
  return document.version === MIND_MAP_DOCUMENT_VERSION_V2
    ? cloneMindMapDocumentV2(document)
    : cloneMindMapDocumentV3(document);
}
