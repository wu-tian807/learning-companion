import dagre from '@dagrejs/dagre';

import type { MindMapDocumentV1, MindMapNodeV1 } from './document';

export const MIND_MAP_LAYOUT_NODE_WIDTH = 244;
export const MIND_MAP_LAYOUT_NODE_HEIGHT = 104;

export interface MindMapLayoutNode {
  readonly id: string;
  readonly node: MindMapNodeV1;
  readonly depth: number;
  readonly hiddenDescendantCount: number;
  readonly position: Readonly<{
    x: number;
    y: number;
  }>;
}

export interface MindMapLayoutEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface MindMapLayout {
  readonly nodes: readonly MindMapLayoutNode[];
  readonly edges: readonly MindMapLayoutEdge[];
}

interface VisibleNode {
  readonly id: string;
  readonly depth: number;
}

function calculateSubtreeSizes(
  document: MindMapDocumentV1,
): ReadonlyMap<string, number> {
  const order: string[] = [];
  const pending = [document.rootNodeId];

  while (pending.length > 0) {
    const nodeId = pending.pop();

    if (nodeId === undefined) {
      continue;
    }

    order.push(nodeId);
    pending.push(...document.nodes[nodeId].childIds);
  }

  const sizes = new Map<string, number>();

  for (const nodeId of order.reverse()) {
    sizes.set(
      nodeId,
      1 +
        document.nodes[nodeId].childIds.reduce(
          (size, childId) => size + (sizes.get(childId) ?? 0),
          0,
        ),
    );
  }

  return sizes;
}

function collectVisibleTree(
  document: MindMapDocumentV1,
  collapsedNodeIds: ReadonlySet<string>,
): {
  readonly nodes: readonly VisibleNode[];
  readonly edges: readonly MindMapLayoutEdge[];
} {
  const nodes: VisibleNode[] = [];
  const edges: MindMapLayoutEdge[] = [];
  const pending: VisibleNode[] = [
    { id: document.rootNodeId, depth: 0 },
  ];

  while (pending.length > 0) {
    const visibleNode = pending.pop();

    if (!visibleNode) {
      continue;
    }

    nodes.push(visibleNode);
    const node = document.nodes[visibleNode.id];

    if (collapsedNodeIds.has(node.id)) {
      continue;
    }

    for (const childId of node.childIds) {
      edges.push({
        id: `${node.id}->${childId}`,
        source: node.id,
        target: childId,
      });
    }

    for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
      pending.push({
        id: node.childIds[index]!,
        depth: visibleNode.depth + 1,
      });
    }
  }

  return { nodes, edges };
}

export function createMindMapLayout(
  document: MindMapDocumentV1,
  collapsedNodeIds: ReadonlySet<string>,
): MindMapLayout {
  const visible = collectVisibleTree(document, collapsedNodeIds);
  const subtreeSizes = calculateSubtreeSizes(document);
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    ranker: 'tight-tree',
    ranksep: 88,
    nodesep: 28,
    edgesep: 18,
    marginx: 30,
    marginy: 30,
  });

  for (const { id } of visible.nodes) {
    graph.setNode(id, {
      width: MIND_MAP_LAYOUT_NODE_WIDTH,
      height: MIND_MAP_LAYOUT_NODE_HEIGHT,
    });
  }

  for (const edge of visible.edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return Object.freeze({
    nodes: Object.freeze(
      visible.nodes.map(({ id, depth }) => {
        const position = graph.node(id);

        if (!position) {
          throw new Error(`Mind Map 节点布局缺失：${id}`);
        }

        return Object.freeze({
          id,
          node: document.nodes[id],
          depth,
          hiddenDescendantCount: collapsedNodeIds.has(id)
            ? (subtreeSizes.get(id) ?? 1) - 1
            : 0,
          position: Object.freeze({
            x: position.x - MIND_MAP_LAYOUT_NODE_WIDTH / 2,
            y: position.y - MIND_MAP_LAYOUT_NODE_HEIGHT / 2,
          }),
        });
      }),
    ),
    edges: Object.freeze(
      visible.edges.map((edge) => Object.freeze(edge)),
    ),
  });
}
