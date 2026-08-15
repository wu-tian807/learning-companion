import { describe, expect, it } from 'vitest';

import { GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_DEFINITION } from './create-agent-provider-service';

describe('generation center Provider Selector registration', () => {
  it('declares a real Codex default instead of relying on Renderer form fallbacks', () => {
    expect(
      GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_DEFINITION.defaultSelection,
    ).toEqual({
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    });
  });
});
