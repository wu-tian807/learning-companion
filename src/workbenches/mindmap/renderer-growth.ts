import type { MindMapDocument } from './document';

const BRANCH_DEPTH_DELAY_MS = 150;
const BRANCH_SIBLING_DELAY_MS = 42;
const MAX_BRANCH_DELAY_MS = 620;
const NODE_FOLLOW_DELAY_MS = 90;
const GROWTH_ANIMATION_TAIL_MS = 460;

export interface MindMapGrowthWave {
  readonly nodeDelayById: ReadonlyMap<string, number>;
  readonly edgeDelayById: ReadonlyMap<string, number>;
  readonly lifetimeMs: number;
}

interface MindMapTreePlacement {
  readonly parentId?: string;
  readonly siblingIndex: number;
  readonly revealDepth: number;
}

function createGrowthWave(
  document: MindMapDocument,
  revealedNodeIds: ReadonlySet<string>,
): MindMapGrowthWave | undefined {
  if (revealedNodeIds.size === 0) {
    return undefined;
  }

  const placements = new Map<string, MindMapTreePlacement>();
  placements.set(document.rootNodeId, {
    siblingIndex: 0,
    revealDepth: revealedNodeIds.has(document.rootNodeId) ? 1 : 0,
  });
  const pending = [document.rootNodeId];

  while (pending.length > 0) {
    const parentId = pending.shift();

    if (parentId === undefined) {
      continue;
    }

    const parentPlacement = placements.get(parentId);

    if (!parentPlacement) {
      continue;
    }

    document.nodes[parentId].childIds.forEach(
      (childId, siblingIndex) => {
        placements.set(childId, {
          parentId,
          siblingIndex,
          revealDepth: revealedNodeIds.has(childId)
            ? revealedNodeIds.has(parentId)
              ? parentPlacement.revealDepth + 1
              : 1
            : 0,
        });
        pending.push(childId);
      },
    );
  }

  const nodeDelayById = new Map<string, number>();
  const edgeDelayById = new Map<string, number>();
  let latestNodeDelay = 0;

  for (const nodeId of revealedNodeIds) {
    const placement = placements.get(nodeId);

    if (!placement?.parentId) {
      continue;
    }

    const edgeDelay = Math.min(
      (Math.max(placement.revealDepth, 1) - 1) *
        BRANCH_DEPTH_DELAY_MS +
        placement.siblingIndex * BRANCH_SIBLING_DELAY_MS,
      MAX_BRANCH_DELAY_MS,
    );
    const nodeDelay = edgeDelay + NODE_FOLLOW_DELAY_MS;

    edgeDelayById.set(`${placement.parentId}->${nodeId}`, edgeDelay);
    nodeDelayById.set(nodeId, nodeDelay);
    latestNodeDelay = Math.max(latestNodeDelay, nodeDelay);
  }

  if (nodeDelayById.size === 0) {
    return undefined;
  }

  return {
    nodeDelayById,
    edgeDelayById,
    lifetimeMs: latestNodeDelay + GROWTH_ANIMATION_TAIL_MS,
  };
}

function collectVisibleNodeIds(
  document: MindMapDocument,
  collapsedNodeIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const visibleNodeIds = new Set<string>();
  const pending = [document.rootNodeId];

  while (pending.length > 0) {
    const nodeId = pending.pop();

    if (nodeId === undefined) {
      continue;
    }

    visibleNodeIds.add(nodeId);

    if (!collapsedNodeIds.has(nodeId)) {
      pending.push(...document.nodes[nodeId].childIds);
    }
  }

  return visibleNodeIds;
}

export function createMindMapNodeGrowthWave(
  document: MindMapDocument,
  nodeId: string,
): MindMapGrowthWave | undefined {
  const node = document.nodes[nodeId];

  return node
    ? createGrowthWave(document, new Set(node.childIds))
    : undefined;
}

export function createMindMapExpandAllGrowthWave(
  document: MindMapDocument,
  collapsedNodeIds: ReadonlySet<string>,
): MindMapGrowthWave | undefined {
  const visibleNodeIds = collectVisibleNodeIds(
    document,
    collapsedNodeIds,
  );
  const revealedNodeIds = new Set(
    Object.keys(document.nodes).filter(
      (nodeId) => !visibleNodeIds.has(nodeId),
    ),
  );

  return createGrowthWave(document, revealedNodeIds);
}
