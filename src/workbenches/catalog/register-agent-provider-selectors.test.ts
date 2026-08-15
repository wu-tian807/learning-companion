import { describe, expect, it } from 'vitest';

import { AgentProviderSelectorRegistry } from '../../main/agents/agent-provider-selector-registry';
import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../shared/agent-provider-selectors';
import {
  registerWorkbenchAgentProviderSelectors,
  WORKBENCH_AGENT_PROVIDER_SELECTOR_DEFINITION,
} from './register-agent-provider-selectors';

describe('registerWorkbenchAgentProviderSelectors', () => {
  it('registers one reusable Workbench AI configuration slot', () => {
    const registry = new AgentProviderSelectorRegistry();

    registerWorkbenchAgentProviderSelectors(registry);

    expect(registry.list()).toEqual([
      WORKBENCH_AGENT_PROVIDER_SELECTOR_DEFINITION,
    ]);
    expect(registry.require(WORKBENCH_AGENT_PROVIDER_SELECTOR_ID)).toEqual(
      WORKBENCH_AGENT_PROVIDER_SELECTOR_DEFINITION,
    );
    expect(WORKBENCH_AGENT_PROVIDER_SELECTOR_DEFINITION.defaultSelection).toEqual({
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    });
  });
});
