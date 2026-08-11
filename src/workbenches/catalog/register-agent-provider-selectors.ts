import type { AgentProviderSelectorRegistry } from '../../main/agents/agent-provider-selector-registry';
import type { AgentProviderSelectorDefinitionSnapshot } from '../../shared/agent-providers';
import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../shared/agent-provider-selectors';

export const WORKBENCH_AGENT_PROVIDER_SELECTOR_DEFINITION =
  Object.freeze({
    id: WORKBENCH_AGENT_PROVIDER_SELECTOR_ID,
    displayName: '工作台 AI',
    description: '用于 EPUB、PDF 等 Workbench 中的解释、问答与辅助操作。',
  }) satisfies AgentProviderSelectorDefinitionSnapshot;

export function registerWorkbenchAgentProviderSelectors(
  registry: AgentProviderSelectorRegistry,
): void {
  registry.register(WORKBENCH_AGENT_PROVIDER_SELECTOR_DEFINITION);
}
