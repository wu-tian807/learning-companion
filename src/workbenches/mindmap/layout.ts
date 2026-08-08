import type { MindMapDocumentV1, MindMapNodeV1 } from './document';

export const MIND_MAP_LAYOUT_NODE_WIDTH = 280;
export const MIND_MAP_LAYOUT_NODE_MIN_HEIGHT = 104;

export interface MindMapLayoutNode {
  readonly id: string;
  readonly node: MindMapNodeV1;
  readonly depth: number;
  readonly hiddenDescendantCount: number;
  readonly size: Readonly<{
    width: number;
    height: number;
  }>;
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

const HORIZONTAL_GAP = 88;
const VERTICAL_GAP = 28;
const LAYOUT_MARGIN = 30;
const TITLE_UNITS_PER_LINE = 28;
const FOCUS_UNITS_PER_LINE = 34;
const NODE_VERTICAL_CHROME = 64;

function textDisplayUnits(value: string): number {
  let units = 0;

  for (const character of value) {
    if (character === '\t') {
      units += 4;
      continue;
    }

    units +=
      (character.codePointAt(0) ?? 0) > 0xff ||
      /[MWmw@#%&]/u.test(character)
        ? 2
        : 1;
  }

  return units;
}

function wrappedLineCount(value: string, unitsPerLine: number): number {
  return value.split(/\r\n?|\n/u).reduce(
    (count, line) =>
      count + Math.max(1, Math.ceil(textDisplayUnits(line) / unitsPerLine)),
    0,
  );
}

export function calculateMindMapNodeHeight(node: MindMapNodeV1): number {
  const titleLines = wrappedLineCount(node.title, TITLE_UNITS_PER_LINE);
  const focusLines = wrappedLineCount(node.focus, FOCUS_UNITS_PER_LINE);

  return Math.max(
    MIND_MAP_LAYOUT_NODE_MIN_HEIGHT,
    NODE_VERTICAL_CHROME + titleLines * 18 + focusLines * 16,
  );
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
  const nodeSizes = new Map(
    visible.nodes.map(({ id }) => [
      id,
      Object.freeze({
        width: MIND_MAP_LAYOUT_NODE_WIDTH,
        height: calculateMindMapNodeHeight(document.nodes[id]),
      }),
    ]),
  );
  const visibleSubtreeHeights = new Map<string, number>();
  const positions = new Map<string, Readonly<{ x: number; y: number }>>();

  const visibleChildIds = (nodeId: string): readonly string[] =>
    collapsedNodeIds.has(nodeId)
      ? []
      : document.nodes[nodeId].childIds;

  const measureSubtree = (nodeId: string): number => {
    const existing = visibleSubtreeHeights.get(nodeId);

    if (existing !== undefined) {
      return existing;
    }

    const children = visibleChildIds(nodeId);
    const childrenHeight =
      children.reduce(
        (height, childId) => height + measureSubtree(childId),
        0,
      ) + Math.max(0, children.length - 1) * VERTICAL_GAP;
    const height = Math.max(
      nodeSizes.get(nodeId)?.height ?? MIND_MAP_LAYOUT_NODE_MIN_HEIGHT,
      childrenHeight,
    );
    visibleSubtreeHeights.set(nodeId, height);
    return height;
  };

  const placeSubtree = (
    nodeId: string,
    depth: number,
    subtreeTop: number,
  ): void => {
    const size = nodeSizes.get(nodeId);

    if (!size) {
      throw new Error(`Mind Map 节点尺寸缺失：${nodeId}`);
    }

    const subtreeHeight = measureSubtree(nodeId);
    const centerY = subtreeTop + subtreeHeight / 2;

    positions.set(
      nodeId,
      Object.freeze({
        x:
          LAYOUT_MARGIN +
          depth * (MIND_MAP_LAYOUT_NODE_WIDTH + HORIZONTAL_GAP),
        y: centerY - size.height / 2,
      }),
    );

    const children = visibleChildIds(nodeId);
    const childrenHeight =
      children.reduce(
        (height, childId) => height + measureSubtree(childId),
        0,
      ) + Math.max(0, children.length - 1) * VERTICAL_GAP;
    let childTop = subtreeTop + (subtreeHeight - childrenHeight) / 2;

    for (const childId of children) {
      placeSubtree(childId, depth + 1, childTop);
      childTop += measureSubtree(childId) + VERTICAL_GAP;
    }
  };

  placeSubtree(document.rootNodeId, 0, LAYOUT_MARGIN);

  return Object.freeze({
    nodes: Object.freeze(
      visible.nodes.map(({ id, depth }) => {
        const position = positions.get(id);
        const size = nodeSizes.get(id);

        if (!position || !size) {
          throw new Error(`Mind Map 节点布局缺失：${id}`);
        }

        return Object.freeze({
          id,
          node: document.nodes[id],
          depth,
          hiddenDescendantCount: collapsedNodeIds.has(id)
            ? (subtreeSizes.get(id) ?? 1) - 1
            : 0,
          size,
          position,
        });
      }),
    ),
    edges: Object.freeze(
      visible.edges.map((edge) => Object.freeze(edge)),
    ),
  });
}
