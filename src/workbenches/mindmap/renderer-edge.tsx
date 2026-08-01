import {
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

import type { MindMapFlowEdge } from './renderer-flow-model';

function MindMapBranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}: EdgeProps<MindMapFlowEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
    offset: 18,
  });
  const growthDelayMs = data?.growthDelayMs;

  return (
    <BaseEdge
      id={id}
      path={path}
      pathLength={1}
      markerEnd={markerEnd}
      interactionWidth={0}
      className={
        growthDelayMs === undefined
          ? undefined
          : 'mindmap-edge-path--growing'
      }
      style={
        growthDelayMs === undefined
          ? style
          : {
              ...style,
              animationDelay: `${growthDelayMs}ms`,
            }
      }
    />
  );
}

export const mindMapEdgeTypes = {
  mindmap: MindMapBranchEdge,
};
