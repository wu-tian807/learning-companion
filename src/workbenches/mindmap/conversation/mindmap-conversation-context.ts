import type { JsonValue } from '../../../shared/workbench/protocol';
import { parseAssetTarget, type AssetTarget } from '../../../shared/workbench/asset-target';

export const MIND_MAP_CONVERSATION_CONTEXT_PROVIDER_ID =
  'builtin.mindmap.conversation';
export const MIND_MAP_CONVERSATION_CONTEXT_FORMAT =
  'learning-companion/mindmap-conversation-context';
export const MIND_MAP_CONVERSATION_CONTEXT_VERSION = 1;

export interface MindMapConversationPathItem {
  readonly nodeId: string;
  readonly title: string;
}

export interface MindMapConversationReference {
  readonly assetId: string;
  readonly referenceId: string;
  readonly contentRevision: string;
  readonly target: AssetTarget;
}

export type MindMapConversationContext = JsonValue & {
  readonly format: typeof MIND_MAP_CONVERSATION_CONTEXT_FORMAT;
  readonly version: typeof MIND_MAP_CONVERSATION_CONTEXT_VERSION;
  readonly nodeId: string;
  readonly title: string;
  readonly focus: string;
  readonly path: readonly MindMapConversationPathItem[];
  readonly target: AssetTarget;
  readonly sourceRevision: string;
  readonly references: readonly MindMapConversationReference[];
  readonly relatedAssetIds: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTarget(value: unknown): value is AssetTarget {
  return parseAssetTarget(value) !== undefined;
}

export function isMindMapConversationContext(
  value: unknown,
): value is MindMapConversationContext {
  if (!isRecord(value) ||
      value.format !== MIND_MAP_CONVERSATION_CONTEXT_FORMAT ||
      value.version !== MIND_MAP_CONVERSATION_CONTEXT_VERSION ||
      !text(value.nodeId) || !text(value.title) || !text(value.focus) ||
      !text(value.sourceRevision) || !isTarget(value.target) ||
      !Array.isArray(value.path) || value.path.length === 0 ||
      !Array.isArray(value.references) || !Array.isArray(value.relatedAssetIds)) {
    return false;
  }
  return value.path.every((item) => isRecord(item) && text(item.nodeId) && text(item.title)) &&
    value.references.every((item) => isRecord(item) && text(item.assetId) &&
      text(item.referenceId) && text(item.contentRevision) && isTarget(item.target)) &&
    value.relatedAssetIds.every(text) &&
    new Set(value.relatedAssetIds).size === value.relatedAssetIds.length;
}

export function parseMindMapConversationContext(
  value: JsonValue | undefined,
): MindMapConversationContext | undefined {
  return isMindMapConversationContext(value) ? value : undefined;
}
