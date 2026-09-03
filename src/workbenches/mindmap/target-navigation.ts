import type { AssetTarget } from '../../shared/workbench/asset-target';
import type { MindMapDocument } from './document';
import { isMindMapFrameTarget, isMindMapNodeTarget } from './shared';

export interface MindMapTargetNavigation {
  /** Nodes that the viewport should fit after reveal. */
  readonly nodeIds: readonly string[];
  /** Target nodes plus every ancestor that must be expanded. */
  readonly visibleNodeIds: readonly string[];
  readonly selectedNodeId?: string;
}

export function resolveMindMapTargetNavigation(
  document: MindMapDocument,
  target: AssetTarget,
): MindMapTargetNavigation | undefined {
  if (target.scope !== 'content') return undefined;
  const selectedNodeId = isMindMapNodeTarget(target)
    ? target.targetPayload.nodeId
    : undefined;
  const nodeIds = selectedNodeId
    ? (document.nodes[selectedNodeId] ? [selectedNodeId] : undefined)
    : isMindMapFrameTarget(target)
      ? document.frames[target.targetPayload.frameId]?.nodeIds
      : undefined;
  if (!nodeIds?.length) return undefined;

  const parentByNodeId = new Map<string, string>();
  for (const node of Object.values(document.nodes)) {
    for (const childId of node.childIds) {
      parentByNodeId.set(childId, node.id);
    }
  }
  const visibleNodeIds = new Set(nodeIds);
  for (const nodeId of nodeIds) {
    let parentId = parentByNodeId.get(nodeId);
    while (parentId) {
      visibleNodeIds.add(parentId);
      parentId = parentByNodeId.get(parentId);
    }
  }

  return Object.freeze({
    nodeIds: Object.freeze([...nodeIds]),
    visibleNodeIds: Object.freeze([...visibleNodeIds]),
    ...(selectedNodeId ? { selectedNodeId } : {}),
  });
}
