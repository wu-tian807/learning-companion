import type { WorkbenchConversationContribution } from '../../../renderer/conversation/conversation-contracts';
import type { MindMapWorkbenchPayload } from '../shared';
import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  createMindMapNodeTarget,
} from '../shared';
import {
  MIND_MAP_CONVERSATION_CONTEXT_FORMAT,
  MIND_MAP_CONVERSATION_CONTEXT_PROVIDER_ID,
  MIND_MAP_CONVERSATION_CONTEXT_VERSION,
  parseMindMapConversationContext,
  type MindMapConversationContext,
} from './mindmap-conversation-context';

export interface MindMapConversationContribution
  extends WorkbenchConversationContribution {
  readonly createContext: (nodeId: string) => MindMapConversationContext | undefined;
}

function pathToNode(payload: MindMapWorkbenchPayload, nodeId: string) {
  const visit = (
    currentId: string,
    path: { nodeId: string; title: string }[],
  ): { nodeId: string; title: string }[] | undefined => {
    const node = payload.document.nodes[currentId];
    if (!node) return undefined;
    const nextPath = [...path, { nodeId: node.id, title: node.title }];
    if (node.id === nodeId) return nextPath;
    for (const childId of node.childIds) {
      const result = visit(childId, nextPath);
      if (result) return result;
    }
    return undefined;
  };
  return visit(payload.document.rootNodeId, []);
}

function createContext(
  payload: MindMapWorkbenchPayload,
  nodeId: string,
): MindMapConversationContext | undefined {
  const node = payload.document.nodes[nodeId];
  const path = pathToNode(payload, nodeId);
  if (!node || !path) return undefined;
  const associations = payload.associations.byNode[nodeId];
  const references = (associations?.references ?? []).map(({ reference, binding }) => ({
    assetId: reference.sourceAssetId,
    referenceId: binding.referenceId,
    contentRevision: binding.contentRevision,
    target: binding.target,
  }));
  const relatedAssetIds = [...new Set([
    ...references.map(({ assetId }) => assetId),
    ...(associations?.links ?? []).map(({ link }) => link.targetAssetId),
  ])];
  return Object.freeze({
    format: MIND_MAP_CONVERSATION_CONTEXT_FORMAT,
    version: MIND_MAP_CONVERSATION_CONTEXT_VERSION,
    nodeId,
    title: node.title,
    focus: node.focus,
    path: Object.freeze(path),
    target: createMindMapNodeTarget(nodeId),
    sourceRevision: payload.revision,
    references: Object.freeze(references),
    relatedAssetIds: Object.freeze(relatedAssetIds),
  }) as unknown as MindMapConversationContext;
}

export function createMindMapConversationContribution(
  payload: MindMapWorkbenchPayload,
  onContextReleased?: (context: MindMapConversationContext | undefined) => void,
): MindMapConversationContribution {
  return Object.freeze({
    contextProviderId: MIND_MAP_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'reference' as const,
    contextRequired: true,
    contextRequiredMessage: '请先选择一个 Mind Map 节点。',
    isContext: (context: JsonValue) => {
      return parseMindMapConversationContext(context) !== undefined;
    },
    contextAssetIds: (context: JsonValue) => {
      const parsed = context as unknown as Partial<MindMapConversationContext>;
      return parsed.relatedAssetIds ?? [];
    },
    onContextReleased: (context: JsonValue | undefined) => {
      onContextReleased?.(context as MindMapConversationContext | undefined);
    },
    createContext: (nodeId: string) => createContext(payload, nodeId),
  });
}
