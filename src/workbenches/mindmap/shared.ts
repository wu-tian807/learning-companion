import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import {
  isAssetTarget,
} from '../../shared/workbench/anchor';
import {
  isAssetLink,
  isAssetReference,
} from '../../shared/asset-associations';
import { MIND_MAP_ASSET_MEDIA_TYPE } from '../../shared/asset-media-types';
import {
  CORE_RENDERER_TRANSPORT_FACILITY_ID,
  createContextMenuSurfaceFacilityDeclaration,
  overflowSurfaceFacilityDeclaration,
  rendererTransportFacilityDeclaration,
} from '../../shared/workbench/facilities/core-facilities';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import {
  isJsonValue,
  type JsonValue,
  type WorkbenchCommand,
} from '../../shared/workbench/protocol';
import type {
  ResolvedMindMapAssociations,
  ResolvedMindMapSubjectAssociations,
  StaleMindMapAssociationBinding,
} from './association-mapper';
import {
  isMindMapAgentLocatorV1,
  isMindMapDocument,
  type MindMapDocument,
} from './document';

export const MIND_MAP_MEDIA_TYPE = MIND_MAP_ASSET_MEDIA_TYPE;
export const MIND_MAP_WORKBENCH_ID = 'builtin.mindmap';
export const MIND_MAP_STATE_SCHEMA_VERSION = 2;
export const MIND_MAP_NODE_ANCHOR_TYPE = 'mindmap.node';
export const MIND_MAP_NODE_ANCHOR_VERSION = 1;
export const MIND_MAP_FRAME_ANCHOR_TYPE = 'mindmap.frame';
export const MIND_MAP_FRAME_ANCHOR_VERSION = 1;

export const mindMapWorkbenchManifest: AssetWorkbenchManifest<
  typeof MIND_MAP_WORKBENCH_ID
> = {
  id: MIND_MAP_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: [MIND_MAP_MEDIA_TYPE],
  requiredContentCapabilities: ['read-bytes'],
  supportedAnchorTypes: [
    MIND_MAP_NODE_ANCHOR_TYPE,
    MIND_MAP_FRAME_ANCHOR_TYPE,
  ],
  facilities: [
    rendererTransportFacilityDeclaration,
    overflowSurfaceFacilityDeclaration,
    createContextMenuSurfaceFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
  ],
};

export interface MindMapNodeAnchorPayloadV1 {
  readonly nodeId: string;
}

export interface MindMapFrameAnchorPayloadV1 {
  readonly frameId: string;
}

export interface MindMapViewportV1 {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface MindMapWorkbenchViewStateV1 {
  readonly collapsedNodeIds: readonly string[];
  readonly viewport?: MindMapViewportV1;
}

export interface MindMapWorkbenchStateV1 {
  readonly viewState: MindMapWorkbenchViewStateV1;
}

export interface MindMapWorkbenchPayload {
  readonly document: MindMapDocument;
  readonly revision: string;
  readonly associations: ResolvedMindMapAssociations;
  readonly viewState: MindMapWorkbenchViewStateV1;
}

export interface MindMapSaveViewStatePayload {
  readonly viewState: MindMapWorkbenchViewStateV1;
}

export interface MindMapSaveViewStateResult {
  readonly saved: true;
  readonly savedTime: number;
}

export const mindMapCommands = {
  saveViewState: 'mindmap:save-view-state',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNormalizedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value === value.trim()
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMindMapViewportV1(
  value: unknown,
): value is MindMapViewportV1 {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.zoom) &&
    value.zoom >= 0.05 &&
    value.zoom <= 8
  );
}

function isResolvedMindMapSubjectAssociations(
  value: unknown,
): value is ResolvedMindMapSubjectAssociations {
  return (
    isRecord(value) &&
    Array.isArray(value.references) &&
    value.references.every(
      (binding) => {
        if (
          !isRecord(binding) ||
          !isAssetReference(binding.reference)
        ) {
          return false;
        }

        return isAssetTarget(binding.sourceTarget) ||
          (isNormalizedId(binding.sourceRevision) &&
            isMindMapAgentLocatorV1(binding.agentLocator));
      },
    ) &&
    Array.isArray(value.links) &&
    value.links.every(isAssetLink)
  );
}

function isResolvedSubjectMap(
  value: unknown,
  subjects: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, ResolvedMindMapSubjectAssociations>> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([subjectId, associations]) =>
        Object.hasOwn(subjects, subjectId) &&
        isResolvedMindMapSubjectAssociations(associations),
    )
  );
}

function isStaleMindMapAssociationBinding(
  value: unknown,
): value is StaleMindMapAssociationBinding {
  return (
    isRecord(value) &&
    (value.subjectKind === 'node' || value.subjectKind === 'frame') &&
    isNormalizedId(value.subjectId) &&
    (value.kind === 'reference' || value.kind === 'link') &&
    isNormalizedId(value.associationId)
  );
}

function isResolvedMindMapAssociations(
  value: unknown,
  document: MindMapDocument,
): value is ResolvedMindMapAssociations {
  return (
    isRecord(value) &&
    isResolvedSubjectMap(value.byNode, document.nodes) &&
    isResolvedSubjectMap(value.byFrame, document.frames) &&
    Array.isArray(value.staleBindings) &&
    value.staleBindings.every((binding) => {
      if (!isStaleMindMapAssociationBinding(binding)) {
        return false;
      }

      return Object.hasOwn(
        binding.subjectKind === 'node'
          ? document.nodes
          : document.frames,
        binding.subjectId,
      );
    })
  );
}

export function cloneMindMapWorkbenchViewState(
  state: MindMapWorkbenchViewStateV1,
): JsonValue & MindMapWorkbenchViewStateV1 {
  if (!isMindMapWorkbenchViewState(state)) {
    throw new Error('Mind Map Workbench 视图状态无效');
  }

  return {
    collapsedNodeIds: [...state.collapsedNodeIds],
    ...(state.viewport
      ? {
          viewport: {
            x: state.viewport.x,
            y: state.viewport.y,
            zoom: state.viewport.zoom,
          },
        }
      : {}),
  };
}

export function isMindMapWorkbenchViewState(
  value: unknown,
): value is MindMapWorkbenchViewStateV1 {
  if (
    !isRecord(value) ||
    !Array.isArray(value.collapsedNodeIds) ||
    !value.collapsedNodeIds.every(isNormalizedId) ||
    new Set(value.collapsedNodeIds).size !==
      value.collapsedNodeIds.length
  ) {
    return false;
  }

  return (
    value.viewport === undefined ||
    isMindMapViewportV1(value.viewport)
  );
}

export function isMindMapWorkbenchStateV1(
  value: unknown,
): value is MindMapWorkbenchStateV1 {
  return (
    isRecord(value) &&
    isMindMapWorkbenchViewState(value.viewState)
  );
}

export function isMindMapWorkbenchPayload(
  value: unknown,
): value is JsonValue & MindMapWorkbenchPayload {
  if (
    !isRecord(value) ||
    !isMindMapDocument(value.document) ||
    !isNormalizedId(value.revision) ||
    !isMindMapWorkbenchViewState(value.viewState) ||
    !isResolvedMindMapAssociations(
      value.associations,
      value.document,
    )
  ) {
    return false;
  }

  return isJsonValue(value);
}

export function isMindMapSaveViewStatePayload(
  value: unknown,
): value is JsonValue & MindMapSaveViewStatePayload {
  return (
    isRecord(value) &&
    isMindMapWorkbenchViewState(value.viewState) &&
    isJsonValue(value)
  );
}

export function isMindMapSaveViewStateResult(
  value: unknown,
): value is JsonValue & MindMapSaveViewStateResult {
  return (
    isRecord(value) &&
    value.saved === true &&
    Number.isSafeInteger(value.savedTime) &&
    Number(value.savedTime) >= 0
  );
}

export function createMindMapSaveViewStateCommand(
  viewState: MindMapWorkbenchViewStateV1,
): WorkbenchCommand {
  return {
    type: mindMapCommands.saveViewState,
    payload: {
      viewState: cloneMindMapWorkbenchViewState(viewState),
    },
  };
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

export function createMindMapFrameTarget(
  frameId: string,
): ContentAnchorTarget {
  if (!isNormalizedId(frameId)) {
    throw new Error('Mind Map frameId 无效');
  }

  return Object.freeze({
    scope: 'content',
    anchorType: MIND_MAP_FRAME_ANCHOR_TYPE,
    anchorVersion: MIND_MAP_FRAME_ANCHOR_VERSION,
    anchorPayload: Object.freeze({ frameId }),
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

export function isMindMapFrameTarget(
  value: unknown,
): value is ContentAnchorTarget & {
  readonly anchorPayload: MindMapFrameAnchorPayloadV1;
} {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.scope === 'content' &&
    value.anchorType === MIND_MAP_FRAME_ANCHOR_TYPE &&
    value.anchorVersion === MIND_MAP_FRAME_ANCHOR_VERSION &&
    isRecord(value.anchorPayload) &&
    isNormalizedId(value.anchorPayload.frameId)
  );
}
