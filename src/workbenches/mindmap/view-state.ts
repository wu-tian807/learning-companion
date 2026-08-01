import type { MindMapDocumentV1 } from './document';
import type { MindMapWorkbenchViewStateV1 } from './shared';

function withCollapsedNodeIds(
  state: MindMapWorkbenchViewStateV1,
  collapsedNodeIds: ReadonlySet<string>,
): MindMapWorkbenchViewStateV1 {
  return {
    collapsedNodeIds: [...collapsedNodeIds],
    ...(state.viewport ? { viewport: state.viewport } : {}),
  };
}

export function expandMindMapNodeOneLevel(
  document: MindMapDocumentV1,
  state: MindMapWorkbenchViewStateV1,
  nodeId: string,
): MindMapWorkbenchViewStateV1 {
  const node = document.nodes[nodeId];
  const collapsedNodeIds = new Set(state.collapsedNodeIds);

  if (
    !node ||
    node.childIds.length === 0 ||
    !collapsedNodeIds.delete(nodeId)
  ) {
    return state;
  }

  for (const childId of node.childIds) {
    if (document.nodes[childId].childIds.length > 0) {
      collapsedNodeIds.add(childId);
    }
  }

  return withCollapsedNodeIds(state, collapsedNodeIds);
}

export function collapseMindMapNode(
  document: MindMapDocumentV1,
  state: MindMapWorkbenchViewStateV1,
  nodeId: string,
): MindMapWorkbenchViewStateV1 {
  const node = document.nodes[nodeId];

  if (
    !node ||
    node.childIds.length === 0 ||
    state.collapsedNodeIds.includes(nodeId)
  ) {
    return state;
  }

  const collapsedNodeIds = new Set(state.collapsedNodeIds);
  collapsedNodeIds.add(nodeId);
  return withCollapsedNodeIds(state, collapsedNodeIds);
}

export function toggleMindMapNode(
  document: MindMapDocumentV1,
  state: MindMapWorkbenchViewStateV1,
  nodeId: string,
): MindMapWorkbenchViewStateV1 {
  return state.collapsedNodeIds.includes(nodeId)
    ? expandMindMapNodeOneLevel(document, state, nodeId)
    : collapseMindMapNode(document, state, nodeId);
}
