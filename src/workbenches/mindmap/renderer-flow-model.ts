import {
  MarkerType,
  Position,
  type Edge,
} from '@xyflow/react';

import type { ResolvedMindMapAssociations } from './association-mapper';
import type { MindMapLayout } from './layout';
import type { MindMapFlowNode } from './renderer-node';

export type MindMapFlowEdge = Edge<
  { readonly growthDelayMs?: number },
  'mindmap'
>;

export interface CreateMindMapFlowNodesOptions {
  readonly layout: MindMapLayout;
  readonly rootNodeId: string;
  readonly associations: ResolvedMindMapAssociations;
  readonly selectedNodeId?: string;
  readonly growthDelayByNodeId?: ReadonlyMap<string, number>;
  readonly onSelectAndCollapse: (nodeId: string) => void;
}

export function createMindMapFlowNodes({
  layout,
  rootNodeId,
  associations,
  selectedNodeId,
  growthDelayByNodeId,
  onSelectAndCollapse,
}: CreateMindMapFlowNodesOptions): readonly MindMapFlowNode[] {
  return layout.nodes.map((layoutNode) => {
    const nodeAssociations = associations.byNode[layoutNode.id];

    return {
      id: layoutNode.id,
      type: 'mindmap',
      position: layoutNode.position,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      selected: selectedNodeId === layoutNode.id,
      selectable: true,
      draggable: false,
      focusable: true,
      width: layoutNode.size.width,
      height: layoutNode.size.height,
      style: {
        width: layoutNode.size.width,
        height: layoutNode.size.height,
      },
      ariaLabel: `${layoutNode.node.title}，${layoutNode.node.focus}`,
      data: {
        title: layoutNode.node.title,
        focus: layoutNode.node.focus,
        isRoot: layoutNode.id === rootNodeId,
        childCount: layoutNode.node.childIds.length,
        hiddenDescendantCount: layoutNode.hiddenDescendantCount,
        referenceCount: nodeAssociations?.references.length ?? 0,
        linkCount: nodeAssociations?.links.length ?? 0,
        growthDelayMs: growthDelayByNodeId?.get(layoutNode.id),
        onCollapse: () => onSelectAndCollapse(layoutNode.id),
      },
    };
  });
}

export function createMindMapFlowEdges(
  layout: MindMapLayout,
  growthDelayByEdgeId?: ReadonlyMap<string, number>,
): readonly MindMapFlowEdge[] {
  return layout.edges.map((edge) => ({
    ...edge,
    type: 'mindmap',
    selectable: false,
    focusable: false,
    data: {
      growthDelayMs: growthDelayByEdgeId?.get(edge.id),
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 12,
      height: 12,
      color: 'rgba(129, 140, 248, 0.42)',
    },
    style: {
      stroke: 'rgba(129, 140, 248, 0.34)',
      strokeWidth: 1.35,
    },
  }));
}
