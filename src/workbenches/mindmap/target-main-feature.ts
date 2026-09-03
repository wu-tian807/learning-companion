import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import {
  MIND_MAP_FRAME_ANCHOR_TYPE,
  MIND_MAP_FRAME_ANCHOR_VERSION,
  MIND_MAP_NODE_ANCHOR_TYPE,
  MIND_MAP_NODE_ANCHOR_VERSION,
  isMindMapFrameTarget,
  isMindMapNodeTarget,
} from './shared';

function isNodePayload(payload: unknown): boolean {
  return isMindMapNodeTarget({
    scope: 'content',
    targetType: MIND_MAP_NODE_ANCHOR_TYPE,
    targetVersion: MIND_MAP_NODE_ANCHOR_VERSION,
    targetPayload: payload,
  });
}

function isFramePayload(payload: unknown): boolean {
  return isMindMapFrameTarget({
    scope: 'content',
    targetType: MIND_MAP_FRAME_ANCHOR_TYPE,
    targetVersion: MIND_MAP_FRAME_ANCHOR_VERSION,
    targetPayload: payload,
  });
}

export const mindMapTargetMainFeature = Object.freeze({
  id: 'builtin.mindmap.targets',
  registerAssetTargets({ targets }): void {
    targets.register({
      workbenchId: 'builtin.mindmap',
      targetType: MIND_MAP_NODE_ANCHOR_TYPE,
      version: MIND_MAP_NODE_ANCHOR_VERSION,
      isPayload: isNodePayload,
      agent: {
        description: '思维导图中由稳定 nodeId 标识的节点',
        payloadSchema: {
          type: 'object',
          required: ['nodeId'],
          properties: { nodeId: { type: 'string', minLength: 1 } },
        },
        examplePayloads: [{ nodeId: 'root' }],
      },
      describe(payload): string {
        return `节点 ${(payload as { readonly nodeId: string }).nodeId}`;
      },
    });
    targets.register({
      workbenchId: 'builtin.mindmap',
      targetType: MIND_MAP_FRAME_ANCHOR_TYPE,
      version: MIND_MAP_FRAME_ANCHOR_VERSION,
      isPayload: isFramePayload,
      agent: {
        description: '思维导图中由稳定 frameId 标识的一组节点',
        payloadSchema: {
          type: 'object',
          required: ['frameId'],
          properties: { frameId: { type: 'string', minLength: 1 } },
        },
        examplePayloads: [{ frameId: 'foundations' }],
      },
      describe(payload): string {
        return `Frame ${(payload as { readonly frameId: string }).frameId}`;
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
