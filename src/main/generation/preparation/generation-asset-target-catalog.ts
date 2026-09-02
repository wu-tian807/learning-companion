import type { AssetTargetRegistryApi } from '../../workbench/asset-target-registry';
import {
  cloneAgentUserMessage,
  type AgentUserMessage,
} from '../contracts/agent-message';
import type { PreparedGenerationAssetReferenceBindings } from '../contracts/generation-asset-reference';

export function flattenPreparedGenerationAssetReferences(
  bindings: PreparedGenerationAssetReferenceBindings,
) {
  return Object.values(bindings).flatMap((references) => references);
}

/**
 * Adds only the Workbench-owned Target contracts relevant to the prepared
 * Assets. TaskDefinitions stay media-agnostic and never duplicate payload
 * semantics.
 */
export function appendAssetTargetCatalogToUserMessage(
  message: AgentUserMessage,
  bindings: PreparedGenerationAssetReferenceBindings,
  targets: AssetTargetRegistryApi,
): AgentUserMessage {
  const cloned = cloneAgentUserMessage(message);
  const references = flattenPreparedGenerationAssetReferences(bindings);
  const workbenchIds = [
    ...new Set(
      references.flatMap(({ workbenchId }) =>
        workbenchId ? [workbenchId] : [],
      ),
    ),
  ].sort();
  const catalog = {
    wholeAssetTarget: {
      description: '整份资料',
      example: { scope: 'asset' },
    },
    sources: references.map((reference) => ({
      sourceAlias: reference.alias,
      ...(reference.workbenchId
        ? { workbenchId: reference.workbenchId }
        : {}),
    })),
    workbenches: workbenchIds.map((workbenchId) => ({
      workbenchId,
      targets: targets.listForWorkbench(workbenchId).map((definition) => ({
        description: definition.agent.description,
        targetPayloadSchema: definition.agent.payloadSchema,
        examples: definition.agent.examplePayloads.map((targetPayload) => ({
          scope: 'content',
          targetType: definition.targetType,
          targetVersion: definition.version,
          targetPayload,
        })),
      })),
    })),
  };

  return Object.freeze({
    role: 'user',
    content: Object.freeze([
      ...cloned.content,
      Object.freeze({
        type: 'text' as const,
        text: [
          '以下 AssetTarget 目录由各来源 Workbench 提供。先按 sources 找到 sourceAlias 对应的 workbenchId，再使用该 Workbench 的 Target；任何来源都可使用 wholeAssetTarget：',
          JSON.stringify(catalog, undefined, 2),
        ].join('\n'),
      }),
    ]),
  });
}
